// Tools the concierge model can call (app/api/chat). They run on the server against the full
// catalog, so product names, prices, colors and sizes reach the model as tool results instead
// of a catalog pasted into the prompt, and an add is checked before the model writes its reply.
//
// The bag itself lives in the shopper's browser. add_to_bag and checkout therefore do not
// change anything here: they validate the request and queue an action, and the route hands the
// queued actions to the browser in the same <<<ACTIONS>>> line the reply handler already reads.
// Every guard in lib/store/agent.ts (payment gated on the shopper's own words, the audit of
// claims against state) still runs on them.
import { getProduct, PRODUCTS } from "@/lib/store/catalog"
import { effectivePrice, type Product } from "@/lib/store/types"

export interface BagLine {
  name: string
  color: string
  size: string
  qty: number
  price: number
}

export interface QueuedAction {
  action: "add_to_bag" | "ask_checkout" | "checkout"
  productId?: string
  color?: string
  size?: string
}

export type ToolArgs = Record<string, unknown>

const str = (description: string) => ({ type: "string", description })

/** OpenAI-style tool definitions (Nebius chat completions). */
export const CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search this store's catalog. Returns up to 6 real products with id, name, price, colors and sizes. Call it before naming, recommending or adding any product.",
      parameters: {
        type: "object",
        properties: {
          query: str('Words describing the item, for example "wool trouser", "tee", "loafer".'),
          department: { type: "string", enum: ["women", "men"] },
          color: str("A color the product must come in."),
          max_price: { type: "number", description: "Highest price in dollars." },
          on_sale: { type: "boolean", description: "Only products on sale." },
          new_only: { type: "boolean", description: "Only new arrivals." },
          sort: { type: "string", enum: ["relevance", "price_low", "price_high"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_bag",
      description: "What is in the shopper's bag right now, with the total.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_bag",
      description:
        "Add one product to the shopper's bag. Only when the shopper asked to buy a specific item. Returns ok true with what was added, or ok false with the reason.",
      parameters: {
        type: "object",
        properties: {
          product_id: str("The product id from search_products."),
          color: str("One of the product's colors. Leave out for the default."),
          size: str("One of the product's sizes. Leave out for the default."),
        },
        required: ["product_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checkout",
      description: "Start payment for the bag. Only when the shopper clearly said they are done and want to pay.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
}

function card(p: Product) {
  return {
    id: p.id,
    name: p.name,
    department: p.department,
    category: p.category,
    price: effectivePrice(p),
    on_sale: p.salePrice != null,
    is_new: p.isNew,
    colors: [...p.colors],
    sizes: [...p.sizes],
  }
}

const MAX_RESULTS = 6

/** Catalog search: every filter must hold; query words rank what is left. */
export function searchProducts(args: ToolArgs) {
  const query = words(typeof args.query === "string" ? args.query : "")
  const color = typeof args.color === "string" ? args.color.toLowerCase().trim() : ""
  const maxPrice = typeof args.max_price === "number" && Number.isFinite(args.max_price) ? args.max_price : null
  const filtered = PRODUCTS.filter(
    (p) =>
      (args.department !== "women" && args.department !== "men" ? true : p.department === args.department) &&
      (!color || (p.colors as string[]).includes(color)) &&
      (maxPrice === null || effectivePrice(p) <= maxPrice) &&
      (args.on_sale !== true || p.salePrice != null) &&
      (args.new_only !== true || p.isNew),
  )
  const scored = filtered
    .map((p) => {
      const name = words(p.name)
      const rest = words(`${p.category} ${p.garmentType} ${p.collection} ${p.department} ${p.colors.join(" ")}`)
      const hits = query.reduce((sum, w) => sum + (name.includes(w) ? 3 : rest.includes(w) ? 1 : 0), 0)
      return { p, hits }
    })
    .filter((row) => query.length === 0 || row.hits > 0)
  const byPrice = args.sort === "price_low" ? 1 : args.sort === "price_high" ? -1 : 0
  scored.sort((a, b) =>
    byPrice
      ? byPrice * (effectivePrice(a.p) - effectivePrice(b.p))
      : b.hits - a.hits || b.p.popularity - a.p.popularity,
  )
  const matches = scored.slice(0, MAX_RESULTS).map((row) => card(row.p))
  if (!matches.length) {
    return { matches, note: "Nothing in the catalog matches. Say so; do not invent a product." }
  }
  return { matches, total: scored.length }
}

/** One shopper message: runs the model's tool calls and collects the actions it queued. */
export class ToolSession {
  readonly actions: QueuedAction[] = []
  /** Names of the tools that ran, in order, for the terminal. */
  readonly calls: { name: string; detail: string }[] = []
  private readonly pending: BagLine[] = []

  constructor(private readonly bag: BagLine[]) {}

  run(name: string, args: ToolArgs): unknown {
    const result = this.dispatch(name, args)
    this.calls.push({ name, detail: this.describe(name, args, result) })
    return result
  }

  private dispatch(name: string, args: ToolArgs): unknown {
    if (name === "search_products") return searchProducts(args)
    if (name === "check_bag") return this.checkBag()
    if (name === "add_to_bag") return this.addToBag(args)
    if (name === "checkout") return this.checkout()
    return { ok: false, error: `no tool named ${name}` }
  }

  private describe(name: string, args: ToolArgs, result: unknown): string {
    const r = (result ?? {}) as { matches?: { name: string }[]; ok?: boolean; error?: string; added?: { name: string }; count?: number }
    if (name === "search_products") {
      const asked = Object.entries(args)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
      return `${asked || "everything"} · ${r.matches?.length ?? 0} found`
    }
    if (name === "check_bag") return `${r.count ?? 0} items`
    if (name === "add_to_bag") return r.ok ? `ok · ${r.added?.name ?? ""}` : `refused · ${r.error ?? ""}`
    return r.ok ? "ok" : `refused · ${r.error ?? ""}`
  }

  private checkBag() {
    const items = [...this.bag, ...this.pending]
    return {
      items,
      count: items.reduce((sum, line) => sum + line.qty, 0),
      total: items.reduce((sum, line) => sum + line.qty * line.price, 0),
    }
  }

  private addToBag(args: ToolArgs) {
    const ref = typeof args.product_id === "string" ? args.product_id.trim() : ""
    const product = getProduct(ref) ?? PRODUCTS.find((p) => p.name.toLowerCase() === ref.toLowerCase())
    if (!product) {
      const close = searchProducts({ query: ref.replace(/[-_]/g, " ") }).matches.slice(0, 3)
      return {
        ok: false,
        error: `There is no product "${ref}" in this store. Nothing was added.`,
        ...(close.length ? { closest: close } : {}),
      }
    }
    const color = typeof args.color === "string" && args.color.trim() ? args.color.toLowerCase().trim() : null
    if (color && !(product.colors as string[]).includes(color)) {
      return { ok: false, error: `${product.name} does not come in ${color}. Nothing was added.`, colors: [...product.colors] }
    }
    const size = typeof args.size === "string" && args.size.trim() ? args.size.trim() : null
    const sized = size ? product.sizes.find((s) => s.toLowerCase() === size.toLowerCase()) : null
    if (size && !sized) {
      return { ok: false, error: `${product.name} does not come in size ${size}. Nothing was added.`, sizes: [...product.sizes] }
    }
    this.actions.push({
      action: "add_to_bag",
      productId: product.id,
      ...(color ? { color } : {}),
      ...(sized ? { size: sized } : {}),
    })
    const line = { name: product.name, color: color ?? "default", size: sized ?? "default", qty: 1, price: effectivePrice(product) }
    this.pending.push(line)
    return {
      ok: true,
      added: line,
      next: "Tell the shopper what you added and ask if they are done shopping. The store shows Yes / Not yet buttons.",
    }
  }

  private checkout() {
    if (this.bag.length + this.pending.length === 0) {
      return { ok: false, error: "The bag is empty. Nothing was charged." }
    }
    this.actions.push({ action: "checkout" })
    return {
      ok: true,
      note: "Payment starts only if the shopper's own message asked to pay. Otherwise the store shows Yes / Not yet buttons.",
    }
  }

  /** The queued actions as the browser expects them: an add is always followed by the done-shopping ask. */
  finalActions(): QueuedAction[] {
    const added = this.actions.some((a) => a.action === "add_to_bag")
    const paying = this.actions.some((a) => a.action === "checkout")
    return added && !paying ? [...this.actions, { action: "ask_checkout" }] : [...this.actions]
  }

  /** A reply for the rare case the model acted but wrote nothing. Says only what the tools confirmed. */
  fallbackText(): string {
    const names = this.pending.map((line) => line.name)
    if (names.length) {
      return `I added the ${names.join(" and the ")} to your bag. Are you done shopping, or would you like anything else?`
    }
    return this.actions.some((a) => a.action === "checkout") ? "Taking you to checkout." : ""
  }
}

/** Reads the bag out of the request's context JSON, ignoring anything malformed. */
export function bagFrom(context: unknown): BagLine[] {
  const bag = (context as { bag?: unknown } | null)?.bag
  if (!Array.isArray(bag)) return []
  return bag
    .filter((line): line is BagLine => !!line && typeof line === "object" && typeof (line as BagLine).name === "string")
    .map((line) => ({
      name: line.name,
      color: String(line.color ?? ""),
      size: String(line.size ?? ""),
      qty: Number(line.qty) || 1,
      price: Number(line.price) || 0,
    }))
}

/** The catalog block for a provider without tools. Built here so it is never cut short. */
export function catalogForPrompt() {
  return PRODUCTS.map((p) => ({
    id: p.id,
    name: p.name,
    department: p.department,
    category: p.category,
    colors: [...p.colors],
    sizes: [...p.sizes],
    price: effectivePrice(p),
    isNew: p.isNew,
  }))
}

/**
 * Forwards reply text to the browser but never an action marker: in tool mode the route writes
 * the marker itself from validated tool calls. Holds back a trailing "<" until it is clear
 * whether a marker follows.
 */
export class MarkerGate {
  private full = ""
  private sent = 0

  constructor(private readonly send: (text: string) => void) {}

  push(piece: string): void {
    this.full += piece
    const at = this.full.search(/<{2,}|<\s*ACTIONS/i)
    let end = at === -1 ? this.full.length : at
    if (at === -1 && this.full.endsWith("<")) end -= 1
    if (end > this.sent) {
      this.send(this.full.slice(this.sent, end))
      this.sent = end
    }
  }

  /** Everything the model wrote this round, marker included. */
  raw(): string {
    return this.full
  }

  /** The marker and what follows it, as the model wrote them, or "" when it wrote none. */
  markerTail(): string {
    const at = this.full.search(/<{2,}|<\s*ACTIONS/i)
    return at === -1 ? "" : this.full.slice(at)
  }

  /** Sends a held-back "<" that turned out to be ordinary text. */
  flush(): void {
    if (this.markerTail()) return
    if (this.full.length > this.sent) {
      this.send(this.full.slice(this.sent))
      this.sent = this.full.length
    }
  }

  /** True once any visible text went out. */
  sentAny(): boolean {
    return this.sent > 0
  }
}
