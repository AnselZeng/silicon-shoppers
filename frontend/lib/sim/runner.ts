import { LAYOUT_MOTION } from "@/config/ui"
import { validateLayout } from "@/lib/layout/validate"
import { buildPreview } from "@/lib/layout/preview"
import { modelLayout } from "@/lib/model/adapter"
import type { HomepageDoc, ModelContext } from "@/lib/model/homepage"
import { loadFixtureIndex } from "@/lib/model/fixtures"
import {
  isStorePayload,
  postSimMessage,
  readEnvelope,
  type ParentPayload,
  type StoreEvent,
} from "@/lib/sim/protocol"
import { describeStoreEvent } from "@/lib/sim/tracker"
import { withSpan } from "@/lib/sentry/helpers"
import { useLogStore } from "@/lib/state/logStore"
import { useObsStore } from "@/lib/state/obsStore"
import { useSimStore } from "@/lib/state/simStore"

/** Parent side of the iframe: pushes layouts into the store and logs what the shopper does there. */
class ShellRunner {
  private generation = 0
  private settleWaiters: (() => void)[] = []
  handleMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin) return
    const parsed = readEnvelope(event.data)
    if (!parsed || !isStorePayload(parsed.payload)) return
    const payload = parsed.payload
    if (payload.type === "store_ready") {
      void this.pushPreview()
      return
    }
    if (payload.type === "layout_step") {
      useSimStore.getState().setLayoutProgress({ index: payload.index, total: payload.total })
      useLogStore.getState().push("layout", `step ${payload.index}/${payload.total} · ${payload.label}`)
      return
    }
    if (payload.type === "layout_settled") {
      this.settle()
      return
    }
    this.onStoreEvent(payload.event)
  }

  async loadFixtures() {
    const fixtures = await loadFixtureIndex()
    useSimStore.getState().setFixtures(fixtures)
    useLogStore.getState().push("model", `${fixtures.length} fixtures loaded (hand-written, not model output)`)
  }

  async pushPreview(generation = this.generation, immediate = false) {
    const sim = useSimStore.getState()
    const preview = await buildPreview(sim.layoutPreview, sim.fixtures)
    if (generation !== this.generation) return
    if (useSimStore.getState().layoutPreview !== sim.layoutPreview) return
    useSimStore.getState().setPreview(preview)
    const logs = useLogStore.getState()
    if (immediate) {
      logs.push("layout", `back to ${preview.label}`)
    } else {
      if (preview.note) logs.push("layout", preview.note)
      if (preview.doc) {
        const doc = preview.doc
        logs.push(
          "model",
          `${doc.demo_id ?? doc.user_id ?? "shopper"} · ${doc.evidence?.add_to_bags ?? 0} add-to-bags · ${doc.store_products?.length ?? 0} ranked products`,
        )
      }
      if (preview.stage === "model") {
        logs.push("model", "model output is input for the LLM; the store stays on the house default")
      } else {
        logs.push("layout", `${preview.label} · nav ${preview.layout.nav.order.join(" ")} · ${preview.layout.home.blocks.length} blocks`)
      }
      if (preview.report.fellBack) logs.push("layout", `validator fell back: ${preview.report.error ?? "invalid"}`)
      for (const change of preview.report.changes) logs.push("layout", `fixed · ${change}`)
    }
    withSpan("layout.apply", () => preview.id)
    this.send({
      type: "set_layout",
      layout: preview.layout,
      model: preview.model,
      presetName: preview.stage === "llm" ? preview.label : undefined,
      immediate,
    })
  }

  /** Resolves when the store finishes playing the layout swap, or after a fallback timeout. */
  private waitForSettle(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => this.settle(), LAYOUT_MOTION.settleTimeoutMs)
      this.settleWaiters.push(() => {
        window.clearTimeout(timer)
        resolve()
      })
    })
  }

  private settle() {
    useSimStore.getState().setLayoutProgress(null)
    const waiters = this.settleWaiters
    this.settleWaiters = []
    for (const done of waiters) done()
  }

  private send(payload: ParentPayload) {
    const iframe = useSimStore.getState().iframe
    if (!iframe?.contentWindow) {
      useLogStore.getState().push("sim", "iframe is not ready")
      return
    }
    postSimMessage(iframe.contentWindow, payload)
  }

  private onStoreEvent(event: StoreEvent) {
    const logs = useLogStore.getState()
    logs.push("tracker", describeStoreEvent(event))
    useObsStore.getState().addCrumb(event.type, describeStoreEvent(event))
    if (event.type === "page_view") useSimStore.getState().setRoute(event.route)
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

  preview(id: string) {
    const generation = ++this.generation
    useSimStore.getState().setLayoutPreview(id)
    return this.pushPreview(generation)
  }

  /**
   * Run from the sliders: the edited mix is already written into the document's layout decisions.
   * Resolves once the store has finished playing the swap.
   */
  previewDocument(doc: HomepageDoc, basket: string[], label: string): Promise<void> {
    const generation = ++this.generation
    const id = `shopper:${doc.demo_id ?? doc.user_id ?? "custom"}`
    useSimStore.getState().setLayoutPreview(id)
    const model: ModelContext = { doc, basketIds: basket }
    const result = validateLayout(modelLayout(doc).layout, { model })
    if (generation !== this.generation) return Promise.resolve()
    useSimStore.getState().setPreview({
      id,
      stage: "llm",
      label,
      layout: result.layout,
      model,
      doc,
      basket,
      report: result.report,
    })
    const logs = useLogStore.getState()
    logs.push(
      "model",
      `${doc.demo_id ?? doc.user_id ?? "shopper"} · ${doc.evidence?.add_to_bags ?? 0} add-to-bags · ${doc.store_products?.length ?? 0} ranked products`,
    )
    logs.push("layout", `${label} · nav ${result.layout.nav.order.join(" ")} · ${result.layout.home.blocks.length} blocks`)
    if (result.report.fellBack) logs.push("layout", `validator fell back: ${result.report.error ?? "invalid"}`)
    for (const change of result.report.changes) logs.push("layout", `fixed · ${change}`)
    withSpan("layout.apply", () => id)
    const settled = this.waitForSettle()
    this.send({
      type: "set_layout",
      layout: result.layout,
      model,
      presetName: label,
    })
    return settled
  }

  /** Drops an in-flight run and puts the store back to the layout that was showing. */
  stop(fallbackId: string) {
    const generation = ++this.generation
    const id = fallbackId || "default"
    useSimStore.getState().setLayoutPreview(id)
    useLogStore.getState().push("sim", "stopped")
    this.settle()
    return this.pushPreview(generation, true)
  }

  reset() {
    useLogStore.getState().clear()
    useObsStore.getState().clear()
    this.send({ type: "reset" })
    useLogStore.getState().push("sim", "session cleared")
  }

  command(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    useLogStore.getState().push("sim", `$ ${trimmed}`)
    const [cmd, ...rest] = trimmed.split(/\s+/)
    const arg = rest.join(" ")
    switch (cmd) {
      case "help":
        useLogStore.getState().push("sim", "help · preview default | preview <fixture-id>[:model|:llm] · reset · clear")
        return
      case "preview":
        this.preview(arg || "default")
        return
      case "reset":
        this.reset()
        return
      case "clear":
        useLogStore.getState().clear()
        return
      default:
        useLogStore.getState().push("sim", `unknown command ${cmd ?? ""}`)
    }
  }
}

export const runner = new ShellRunner()
