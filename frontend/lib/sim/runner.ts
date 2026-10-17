import { previewLayout } from "@/lib/layout/preview"
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
  handleMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin) return
    const parsed = readEnvelope(event.data)
    if (!parsed || !isStorePayload(parsed.payload)) return
    const payload = parsed.payload
    if (payload.type === "store_ready") {
      this.pushPreview()
      return
    }
    this.onStoreEvent(payload.event)
  }

  pushPreview() {
    const { layout, presetName } = previewLayout(useSimStore.getState().layoutPreview)
    withSpan("layout.apply", () => presetName ?? "default")
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
    useSimStore.getState().setLayoutPreview(id)
    useLogStore.getState().push("layout", `preview ${id}`)
    this.pushPreview()
  }

  reset() {
    useLogStore.getState().clear()
    useObsStore.getState().clear()
    this.send({ type: "reset" })
    useLogStore.getState().push("sim", "reset")
  }

  command(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    useLogStore.getState().push("sim", `$ ${trimmed}`)
    const [cmd, ...rest] = trimmed.split(/\s+/)
    const arg = rest.join(" ")
    switch (cmd) {
      case "help":
        useLogStore.getState().push("sim", "help · preview <id> · reset · clear")
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
