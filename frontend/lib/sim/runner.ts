"use client"

import { PERSONA_ACCENTS, UI_CONFIG } from "@/config/ui"
import { previewLayout } from "@/lib/layout/preview"
import { DEFAULT_LAYOUT, PERSONA_LAYOUTS } from "@/lib/layout/presets"
import { PERSONA_LABEL, isPersonaId, type PersonaId } from "@/lib/personas/schema"
import { agentPolicy, createMemory, type AgentMemory } from "@/lib/sim/agent"
import { EvidenceEngine, formatProbabilities } from "@/lib/sim/engine"
import {
  isStorePayload,
  postSimMessage,
  readEnvelope,
  type AgentAction,
  type PageState,
  type ParentPayload,
  type StoreEvent,
} from "@/lib/sim/protocol"
import { createRng } from "@/lib/sim/rng"
import { describeStoreEvent } from "@/lib/sim/tracker"
import { setRunContext, withSpan } from "@/lib/sentry/helpers"
import { useLogStore } from "@/lib/state/logStore"
import { useObsStore } from "@/lib/state/obsStore"
import { usePersonaStore } from "@/lib/state/personaStore"
import { isSimSpeed, useSimStore, type SimSpeed } from "@/lib/state/simStore"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

class SimulationRunner {
  private engine = new EvidenceEngine()
  private memory: AgentMemory = createMemory()
  private rng = createRng(42)
  private page: PageState | null = null
  private pageVersion = 0
  private loopToken = 0
  private readyWaiters: Array<() => void> = []
  private pageWaiters: Array<() => void> = []
  private actionWaiters: Array<(result: { ok: boolean; error?: string }) => void> = []
  private pauseWaiters: Array<() => void> = []
  private runSpanOpen = false

  handleMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin) return
    const parsed = readEnvelope(event.data)
    if (!parsed || !isStorePayload(parsed.payload)) return
    const payload = parsed.payload
    if (payload.type === "store_ready") {
      this.readyWaiters.splice(0).forEach((resolve) => resolve())
      const status = useSimStore.getState().status
      if (status !== "running" && status !== "paused") this.pushPreview()
      return
    }
    if (payload.type === "page_state") {
      this.page = payload.state
      this.pageVersion += 1
      useSimStore.getState().setRoute(payload.state.route)
      this.pageWaiters.splice(0).forEach((resolve) => resolve())
      return
    }
    if (payload.type === "action_done") {
      this.actionWaiters.splice(0).forEach((resolve) => resolve({ ok: payload.ok, error: payload.error }))
      return
    }
    if (payload.type === "store_event") {
      this.onStoreEvent(payload.event)
    }
  }

  private pushPreview() {
    const { layout, presetName } = previewLayout(
      useSimStore.getState().layoutPreview,
      usePersonaStore.getState().personas,
    )
    this.send({ type: "set_layout", layout, presetName: presetName ?? undefined })
  }

  private send(payload: ParentPayload) {
    const iframe = useSimStore.getState().iframe
    if (!iframe?.contentWindow) {
      useLogStore.getState().push("sim", "iframe is not ready")
      return
    }
    postSimMessage(iframe.contentWindow, payload)
  }

  private async waitReady(timeoutMs = 4000) {
    if (this.page) return
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => resolve(), timeoutMs)
      this.readyWaiters.push(() => {
        window.clearTimeout(timer)
        resolve()
      })
    })
  }

  private async waitPage(afterVersion: number, timeoutMs = 1800) {
    if (this.pageVersion > afterVersion) return
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => resolve(), timeoutMs)
      this.pageWaiters.push(() => {
        if (this.pageVersion > afterVersion) {
          window.clearTimeout(timer)
          resolve()
        } else {
          this.pageWaiters.push(() => {
            window.clearTimeout(timer)
            resolve()
          })
        }
      })
    })
  }

  private async waitAction(timeoutMs = 4000): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(
        () => resolve({ ok: false, error: "timed out waiting for the store" }),
        timeoutMs,
      )
      this.actionWaiters.push((result) => {
        window.clearTimeout(timer)
        resolve(result)
      })
    })
  }

  private async sleepPaused(ms: number) {
    const slice = 40
    let left = ms
    while (left > 0) {
      const status = useSimStore.getState().status
      if (status !== "running" && status !== "paused") return
      if (status === "paused") {
        await new Promise<void>((resolve) => this.pauseWaiters.push(resolve))
        continue
      }
      const step = Math.min(slice, left)
      await sleep(step)
      left -= step
    }
  }

  private onStoreEvent(event: StoreEvent) {
    const logs = useLogStore.getState()
    logs.push("tracker", describeStoreEvent(event))
    useObsStore.getState().addCrumb(event.type, describeStoreEvent(event))
    const inference = this.engine.update(event)
    logs.push("engine", formatProbabilities(inference.probabilities))
    withSpan("persona.infer", () => inference.personaId ?? "unknown", { event: event.type })
    useSimStore.getState().setInference({
      personaId: inference.personaId,
      probabilities: inference.probabilities,
      classified: inference.classified,
      eventCount: inference.eventCount,
    })
    if ((inference.newlyClassified || inference.changed) && inference.personaId) {
      this.applyClassification(inference.personaId, inference.changed)
    }
    if (event.type === "checkout_started") {
      logs.push("visa", `session ${String(event.properties.sessionId)} · $${String(event.properties.amount)}`)
      useObsStore.getState().note(`visa.session ${String(event.properties.sessionId)}`)
      withSpan("visa.session", () => event.properties.sessionId ?? "", {
        amount: Number(event.properties.amount ?? 0),
      })
    }
    if (event.type === "payment_completed") {
      logs.push("visa", `captured ${String(event.properties.orderId)}`)
      withSpan("visa.capture", () => String(event.properties.orderId ?? ""), {
        amount: Number(event.properties.amount ?? 0),
      })
    }
    if (event.type === "loyalty_awarded") {
      logs.push("visa", `loyalty ${String(event.properties.points)} pts`)
    }
  }

  private applyClassification(personaId: PersonaId, changed: boolean) {
    const layout = PERSONA_LAYOUTS[personaId]
    const name = PERSONA_LABEL[personaId]
    const logs = useLogStore.getState()
    if (!useSimStore.getState().adaptive) {
      logs.push("layout", `${changed ? "reclassified" : "classified"} ${name} · adaptive off`)
      return
    }
    useSimStore.getState().setLayoutPreview(useSimStore.getState().activePersonaId ?? personaId)
    this.send({ type: "set_layout", layout, presetName: name })
    const concierge = layout.conciergeEnabled ? layout.conciergeTone : "off"
    logs.push(
      "layout",
      `${name} · sort ${layout.defaultSort} · checkout ${layout.checkoutVariant} · concierge ${concierge}`,
    )
    withSpan("layout.adapt", () => name, {
      persona: personaId,
      checkout: layout.checkoutVariant,
      concierge,
    })
  }

  async prepare(personaId: string) {
    const persona = usePersonaStore.getState().personas.find((item) => item.id === personaId)
    if (!persona) {
      useLogStore.getState().push("sim", `unknown persona ${personaId}`)
      return false
    }
    const sim = useSimStore.getState()
    useLogStore.getState().clear()
    useObsStore.getState().clear()
    this.engine.reset()
    this.memory = createMemory()
    this.rng = createRng(sim.seed)
    this.page = null
    sim.setInference({
      personaId: null,
      probabilities: {
        price_hunter: 0,
        trend_seeker: 0,
        mission_shopper: 0,
        brand_loyalist: 0,
      },
      classified: false,
      eventCount: 0,
    })
    sim.setLayoutPreview("default")
    sim.setActivePersonaId(persona.id)
    sim.setStatus("running")
    const runId = `run_${sim.seed}_${persona.id}`
    setRunContext({ personaId: persona.id, seed: sim.seed, runId })
    withSpan("simulation.run", () => runId, { persona: persona.id, seed: sim.seed })
    this.runSpanOpen = true
    useLogStore.getState().push("sim", `run ${persona.id} seed ${sim.seed} adaptive ${sim.adaptive ? "on" : "off"}`)
    this.send({ type: "reset" })
    await this.waitReady(2500)
    await sleep(120)
    this.send({ type: "set_layout", layout: DEFAULT_LAYOUT })
    this.send({
      type: "cursor_config",
      color: PERSONA_ACCENTS[persona.baseId],
      speed: sim.speed,
    })
    this.send({ type: "set_debug", showElementIds: sim.showElementIds })
    await sleep(200)
    return true
  }

  private async perform(action: AgentAction) {
    const version = this.pageVersion
    withSpan("agent.step", () => action.type, { type: action.type })
    this.send({ type: "agent_action", action })
    const result = await this.waitAction()
    if (!result.ok) {
      useLogStore.getState().push("sim", result.error ?? "action failed")
    }
    await this.waitPage(version, 1200)
  }

  private async loop(token: number, stepOnce: boolean) {
    const sim = () => useSimStore.getState()
    while (token === this.loopToken && (sim().status === "running" || sim().status === "paused")) {
      if (sim().status === "paused") {
        await new Promise<void>((resolve) => this.pauseWaiters.push(resolve))
        if (token !== this.loopToken) return
      }
      const personaId = sim().activePersonaId
      const persona = usePersonaStore.getState().personas.find((item) => item.id === personaId)
      if (!persona || !this.page) {
        await sleep(150)
        continue
      }
      const decision = agentPolicy.nextAction(this.page, persona, this.rng, this.memory)
      useLogStore.getState().push("agent", decision.reason)
      if (decision.endSession) {
        useLogStore.getState().push("sim", "session_end")
        useObsStore.getState().addCrumb("session_end", decision.reason)
        sim().setStatus("finished")
        return
      }
      await this.perform(decision.action)
      if (stepOnce) {
        sim().setStatus("paused")
        return
      }
      const delay = UI_CONFIG.stepBaseDelayMs / sim().speed
      await this.sleepPaused(delay)
    }
  }

  async run(which?: string) {
    if (which === "all") {
      const ids = ["price_hunter", "trend_seeker", "mission_shopper", "brand_loyalist"]
      for (const id of ids) {
        const ready = await this.prepare(id)
        if (!ready) return
        this.loopToken += 1
        const token = this.loopToken
        await this.loop(token, false)
        if (useSimStore.getState().status === "idle") return
      }
      useSimStore.getState().setStatus("finished")
      useLogStore.getState().push("sim", "run all complete")
      return
    }
    const selected = which && which.length > 0 ? which : usePersonaStore.getState().selectedId
    const ready = await this.prepare(selected)
    if (!ready) return
    this.loopToken += 1
    await this.loop(this.loopToken, false)
  }

  pause() {
    if (useSimStore.getState().status !== "running") return
    useSimStore.getState().setStatus("paused")
    useLogStore.getState().push("sim", "paused")
  }

  resume() {
    if (useSimStore.getState().status !== "paused") return
    useSimStore.getState().setStatus("running")
    useLogStore.getState().push("sim", "resumed")
    this.pauseWaiters.splice(0).forEach((resolve) => resolve())
  }

  async step() {
    const status = useSimStore.getState().status
    if (status === "idle" || status === "finished") {
      const ready = await this.prepare(usePersonaStore.getState().selectedId)
      if (!ready) return
      this.loopToken += 1
      await this.loop(this.loopToken, true)
      return
    }
    if (status === "running") this.pause()
    useSimStore.getState().setStatus("running")
    this.pauseWaiters.splice(0).forEach((resolve) => resolve())
    this.loopToken += 1
    await this.loop(this.loopToken, true)
  }

  reset() {
    this.loopToken += 1
    this.engine.reset()
    this.memory = createMemory()
    this.pauseWaiters.splice(0).forEach((resolve) => resolve())
    useSimStore.getState().setStatus("idle")
    useSimStore.getState().setActivePersonaId(null)
    useSimStore.getState().setInference({
      personaId: null,
      probabilities: {
        price_hunter: 0,
        trend_seeker: 0,
        mission_shopper: 0,
        brand_loyalist: 0,
      },
      classified: false,
      eventCount: 0,
    })
    this.send({ type: "reset" })
    this.send({ type: "set_layout", layout: DEFAULT_LAYOUT })
    useLogStore.getState().push("sim", "reset")
  }

  setSpeed(value: SimSpeed) {
    useSimStore.getState().setSpeed(value)
    const personaId = useSimStore.getState().activePersonaId
    const persona = usePersonaStore.getState().personas.find((item) => item.id === personaId)
    const color = persona ? PERSONA_ACCENTS[persona.baseId] : PERSONA_ACCENTS.price_hunter
    this.send({ type: "cursor_config", color, speed: value })
    useLogStore.getState().push("sim", `speed ${value}`)
  }

  setSeed(seed: number) {
    if (!Number.isFinite(seed) || seed <= 0) {
      useLogStore.getState().push("sim", "seed must be a positive integer")
      return
    }
    useSimStore.getState().setSeed(Math.floor(seed))
    useLogStore.getState().push("sim", `seed ${Math.floor(seed)}`)
  }

  setAdaptive(on: boolean) {
    useSimStore.getState().setAdaptive(on)
    useLogStore.getState().push("sim", `adaptive ${on ? "on" : "off"}`)
    const inferred = useSimStore.getState().inference
    if (on && inferred.classified && inferred.personaId) {
      this.applyClassification(inferred.personaId, false)
    }
  }

  personas() {
    const lines = usePersonaStore
      .getState()
      .personas.map((persona) => `${persona.id}${persona.isCustom ? " custom" : ""}`)
    useLogStore.getState().push("sim", lines.join(" · "))
  }

  clear() {
    useLogStore.getState().clear()
  }

  command(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    useLogStore.getState().push("sim", `$ ${trimmed}`)
    const [cmd, ...rest] = trimmed.split(/\s+/)
    const arg = rest.join(" ")
    switch (cmd) {
      case "help":
        useLogStore.getState().push(
          "sim",
          "help · run [persona-id|all] · pause · resume · step · reset · speed <0.5|1|2|4> · seed <n> · adaptive on|off · personas · clear",
        )
        return
      case "run":
        void this.run(arg || undefined)
        return
      case "pause":
        this.pause()
        return
      case "resume":
        this.resume()
        return
      case "step":
        void this.step()
        return
      case "reset":
        this.reset()
        return
      case "speed": {
        const speed = Number(arg)
        if (!isSimSpeed(speed)) {
          useLogStore.getState().push("sim", "speed must be 0.5, 1, 2, or 4")
          return
        }
        this.setSpeed(speed)
        return
      }
      case "seed":
        this.setSeed(Number(arg))
        return
      case "adaptive":
        if (arg !== "on" && arg !== "off") {
          useLogStore.getState().push("sim", "adaptive on|off")
          return
        }
        this.setAdaptive(arg === "on")
        return
      case "personas":
        this.personas()
        return
      case "clear":
        this.clear()
        return
      default:
        if (cmd && isPersonaId(cmd)) {
          void this.run(cmd)
          return
        }
        useLogStore.getState().push("sim", `unknown command ${cmd ?? ""}`)
    }
  }
}

export const runner = new SimulationRunner()
