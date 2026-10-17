import type { PageState, VisibleElement } from "@/lib/sim/protocol"

export function isShown(el: HTMLElement): boolean {
  if (el.closest("[hidden]")) return false
  const style = window.getComputedStyle(el)
  if (style.display === "none" || style.visibility === "hidden") return false
  const rect = el.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return false
  const vw = window.innerWidth
  const vh = window.innerHeight
  return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw
}

function area(el: HTMLElement): number {
  const rect = el.getBoundingClientRect()
  return rect.width * rect.height
}

export function findAgentElement(agentId: string): HTMLElement | null {
  const nodes = [...document.querySelectorAll<HTMLElement>(`[data-agent-id="${CSS.escape(agentId)}"]`)]
  const visible = nodes.filter((node) => isShown(node))
  visible.sort((a, b) => area(b) - area(a))
  return visible[0] ?? null
}

function flag(value: string | undefined, yes: string): boolean | undefined {
  if (value === undefined) return undefined
  return value === yes
}

export function collectVisibleElements(): VisibleElement[] {
  const nodes = document.querySelectorAll<HTMLElement>("[data-agent-id]")
  const elements: VisibleElement[] = []
  nodes.forEach((el) => {
    if (!isShown(el)) return
    const rect = el.getBoundingClientRect()
    const data = el.dataset
    const price = data.price ? Number(data.price) : undefined
    elements.push({
      agentId: data.agentId ?? "",
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      productId: data.productId,
      price: Number.isFinite(price) ? price : undefined,
      color: data.color,
      isNew: flag(data.isNew, "1"),
      onSale: flag(data.onSale, "1"),
      collection: data.collection,
      name: data.name,
      sort: data.sort,
      filters: data.filters,
      banner: data.banner,
      popup: data.popup,
      checkout: data.checkout,
      count: data.count,
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
    })
  })
  return elements
}

export function readPageState(): PageState {
  const max = document.documentElement.scrollHeight - window.innerHeight
  const scrollPercent = max <= 8 ? 100 : Math.round((window.scrollY / max) * 100)
  return {
    route: window.location.pathname,
    scrollPercent,
    elements: collectVisibleElements(),
  }
}

export function setNativeValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
