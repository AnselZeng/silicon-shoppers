import { afterEach, describe, expect, test, vi } from "vitest"

import { POST } from "@/app/api/chat/route"
import { MarkerGate, searchProducts, ToolSession } from "@/lib/server/chatTools"
import { splitActions } from "@/lib/store/agent"
import { PRODUCTS } from "@/lib/store/catalog"
import { effectivePrice } from "@/lib/store/types"

const tee = PRODUCTS.find((p) => p.id === "m-navy-tee")!
const last = PRODUCTS.at(-1)!

describe("searchProducts", () => {
  test("finds a product by words in its name, best match first", () => {
    const { matches } = searchProducts({ query: tee.name })
    expect(matches[0].id).toBe(tee.id)
    expect(matches[0]).toMatchObject({ name: tee.name, price: effectivePrice(tee), colors: [...tee.colors], sizes: [...tee.sizes] })
    expect(matches.length).toBeLessThanOrEqual(6)
  })

  test("reaches the end of the catalog, which a prompt cut at 24,000 characters did not", () => {
    expect(searchProducts({ query: last.name }).matches.map((m) => m.id)).toContain(last.id)
  })

  test("holds every filter", () => {
    const { matches } = searchProducts({ department: "men", on_sale: true, max_price: 60, color: "navy" })
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      expect(m.department).toBe("men")
      expect(m.on_sale).toBe(true)
      expect(m.price).toBeLessThanOrEqual(60)
      expect(m.colors).toContain("navy")
    }
  })

  test("sorts by price when asked", () => {
    const prices = searchProducts({ department: "women", sort: "price_high" }).matches.map((m) => m.price)
    expect(prices).toEqual([...prices].sort((a, b) => b - a))
    expect(prices[0]).toBe(Math.max(...PRODUCTS.filter((p) => p.department === "women").map(effectivePrice)))
  })

  test("says so when nothing matches instead of returning near misses", () => {
    const out = searchProducts({ query: "galaxy hoverboots" })
    expect(out.matches).toEqual([])
    expect(out.note).toMatch(/do not invent/)
  })
})

describe("ToolSession", () => {
  test("a valid add is queued and followed by the done-shopping ask", () => {
    const session = new ToolSession([])
    const out = session.run("add_to_bag", { product_id: tee.id, color: "navy", size: "m" }) as { ok: boolean; added: { name: string } }
    expect(out.ok).toBe(true)
    expect(out.added.name).toBe(tee.name)
    expect(session.finalActions()).toEqual([
      { action: "add_to_bag", productId: tee.id, color: "navy", size: "M" },
      { action: "ask_checkout" },
    ])
  })

  test("an invented product is refused before the model writes its reply, with real alternatives", () => {
    const session = new ToolSession([])
    const out = session.run("add_to_bag", { product_id: "wool-hoverboots" }) as { ok: boolean; error: string; closest?: { id: string }[] }
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/Nothing was added/)
    expect(out.closest?.length).toBeGreaterThan(0)
    expect(session.finalActions()).toEqual([])
  })

  test("a color or size the product does not come in is refused with the real options", () => {
    const session = new ToolSession([])
    const color = session.run("add_to_bag", { product_id: tee.id, color: "magenta" }) as { ok: boolean; colors: string[] }
    expect(color).toMatchObject({ ok: false, colors: [...tee.colors] })
    const size = session.run("add_to_bag", { product_id: tee.id, size: "XXXXL" }) as { ok: boolean; sizes: string[] }
    expect(size).toMatchObject({ ok: false, sizes: [...tee.sizes] })
    expect(session.finalActions()).toEqual([])
  })

  test("checkout is refused on an empty bag and allowed once something is in it", () => {
    const empty = new ToolSession([])
    expect(empty.run("checkout", {})).toMatchObject({ ok: false })
    expect(empty.finalActions()).toEqual([])

    const afterAdd = new ToolSession([])
    afterAdd.run("add_to_bag", { product_id: tee.id })
    expect(afterAdd.run("checkout", {})).toMatchObject({ ok: true })
    // paying replaces the ask: the browser still gates it on the shopper's own words
    expect(afterAdd.finalActions().map((a) => a.action)).toEqual(["add_to_bag", "checkout"])

    const carried = new ToolSession([{ name: "Wool Trouser", color: "black", size: "M", qty: 1, price: 120 }])
    expect(carried.run("checkout", {})).toMatchObject({ ok: true })
  })

  test("check_bag counts what was already there plus what this reply added", () => {
    const session = new ToolSession([{ name: "Wool Trouser", color: "black", size: "M", qty: 2, price: 120 }])
    session.run("add_to_bag", { product_id: tee.id })
    expect(session.run("check_bag", {})).toMatchObject({ count: 3, total: 240 + effectivePrice(tee) })
  })

  test("records each call for the terminal", () => {
    const session = new ToolSession([])
    session.run("search_products", { query: "tee", color: "navy" })
    session.run("add_to_bag", { product_id: "nope" })
    expect(session.calls[0]).toMatchObject({ name: "search_products" })
    expect(session.calls[0].detail).toMatch(/^query=tee color=navy · \d+ found$/)
    expect(session.calls[1].detail).toMatch(/^refused · /)
  })
})

describe("MarkerGate", () => {
  function run(pieces: string[]) {
    const out: string[] = []
    const gate = new MarkerGate((text) => out.push(text))
    pieces.forEach((piece) => gate.push(piece))
    gate.flush()
    return { shown: out.join(""), tail: gate.markerTail() }
  }

  test("passes ordinary text through", () => {
    expect(run(["Oh, great ", "pick!"])).toEqual({ shown: "Oh, great pick!", tail: "" })
  })

  test("never forwards a marker the model wrote, however it is split", () => {
    const whole = 'Added it.\n<<<ACTIONS>>>[{"action":"checkout"}]'
    for (const cut of [1, 9, 10, 11, 12, 13, 20]) {
      const got = run([whole.slice(0, cut), whole.slice(cut)])
      expect(got.shown, `cut at ${cut}`).toBe("Added it.\n")
      expect(got.tail).toBe('<<<ACTIONS>>>[{"action":"checkout"}]')
    }
  })

  test("releases a lone < that was not a marker", () => {
    expect(run(["under <", "$50 is fine"]).shown).toBe("under <$50 is fine")
    expect(run(["ends with <"]).shown).toBe("ends with <")
  })
})

// ---------------------------------------------------------------- the route, with the model mocked

function sse(chunks: unknown[]) {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

const text = (content: string) => ({ choices: [{ delta: { content } }] })
const call = (id: string, name: string, args: unknown) => ({
  choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }],
})

async function ask(message: string, replies: Response[], context: unknown = { bag: [] }) {
  vi.stubEnv("LLM_PROVIDER", "nebius")
  vi.stubEnv("NEBIUS_API_KEY", "nebius-key")
  const fetch = vi.fn(async () => replies.shift() ?? sse([text("")]))
  vi.stubGlobal("fetch", fetch)
  const res = await POST(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({ message, context }) }))
  const events = (await res.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; text?: string; name?: string; detail?: string; error?: string })
  // what the browser ends up holding: deltas since the last reset
  let reply = ""
  for (const event of events) {
    if (event.type === "reset") reply = ""
    if (event.type === "delta") reply += event.text ?? ""
  }
  const sentBodies = fetch.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as {
    messages: { role: string; content: string; tool_call_id?: string }[]; tools?: unknown[]
  })
  return { events, reply, sentBodies }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("POST /api/chat with tools", () => {
  test("search, add, answer: the action line is written by the server from the validated call", async () => {
    const { events, reply, sentBodies } = await ask(`buy the ${tee.name} in navy, medium`, [
      sse([text("Let me look that up. "), call("c1", "search_products", { query: tee.name })]),
      sse([call("c2", "add_to_bag", { product_id: tee.id, color: "navy", size: "M" })]),
      sse([text(`Oh, great pick! I added the ${tee.name} in navy, size M. `), text("Are you done shopping?")]),
    ])
    expect(events.filter((e) => e.type === "tool").map((e) => e.name)).toEqual(["search_products", "add_to_bag"])
    expect(events.some((e) => e.type === "reset")).toBe(true)
    const { text: shown, actions } = splitActions(reply)
    expect(shown).toBe(`Oh, great pick! I added the ${tee.name} in navy, size M. Are you done shopping?`)
    expect(actions).toEqual([
      { action: "add_to_bag", productId: tee.id, color: "navy", size: "M" },
      { action: "ask_checkout" },
    ])
    // the catalog is not pasted into the prompt, and each tool result went back to the model
    expect(sentBodies[0].messages[0].content).not.toContain(`"id":"${last.id}"`)
    expect(sentBodies[0].tools?.length).toBe(4)
    expect(sentBodies[2].messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual(["c1", "c2"])
    expect(events.at(-1)).toMatchObject({ type: "done", tools: 2 })
  })

  test("a refused add reaches the model as ok false and no action is sent to the browser", async () => {
    const { reply, sentBodies } = await ask("buy galaxy hoverboots", [
      sse([call("c1", "add_to_bag", { product_id: "galaxy-hoverboots" })]),
      sse([text("I could not find Galaxy Hoverboots here, want to see our boots instead?")]),
    ])
    const toolResult = JSON.parse(sentBodies[1].messages.find((m) => m.role === "tool")!.content) as { ok: boolean }
    expect(toolResult.ok).toBe(false)
    expect(splitActions(reply).actions).toEqual([])
    expect(reply).not.toContain("ACTIONS")
  })

  test("a marker the model types itself is not doubled when a tool already queued the action", async () => {
    const { reply } = await ask(`add the ${tee.name}`, [
      sse([call("c1", "add_to_bag", { product_id: tee.id })]),
      sse([text("Added! "), text('<<<ACTIONS>>>[{"action":"add_to_bag","productId":"' + tee.id + '"}]')]),
    ])
    expect(reply.match(/ACTIONS/g)).toHaveLength(1)
    expect(splitActions(reply).actions.filter((a) => a.action === "add_to_bag")).toHaveLength(1)
  })

  test("with no tool call, a hand-written action line still reaches the browser's own checks", async () => {
    const { reply } = await ask(`add the ${tee.name}`, [
      sse([text("Added! "), text('<<<ACTIONS>>>[{"action":"add_to_bag","productId":"' + tee.id + '"}]')]),
    ])
    expect(splitActions(reply)).toMatchObject({ text: "Added!", actions: [{ action: "add_to_bag", productId: tee.id }] })
  })

  test("the model acts but writes nothing: the reply states only what the tool confirmed", async () => {
    const { reply } = await ask(`add the ${tee.name}`, [sse([call("c1", "add_to_bag", { product_id: tee.id })]), sse([text("")])])
    expect(splitActions(reply).text).toBe(`I added the ${tee.name} to your bag. Are you done shopping, or would you like anything else?`)
    expect(splitActions(reply).actions.map((a) => a.action)).toEqual(["add_to_bag", "ask_checkout"])
  })

  test("falls back to the catalog-in-prompt path when the provider refuses the tool request", async () => {
    const refused = new Response(JSON.stringify({ error: { message: "tools not supported" } }), { status: 400 })
    const { events, reply, sentBodies } = await ask("what navy things do you have?", [refused, sse([text("We have a few navy pieces!")])])
    expect(reply).toBe("We have a few navy pieces!")
    expect(events.some((e) => e.type === "error")).toBe(false)
    expect(sentBodies[1].tools).toBeUndefined()
    // the whole catalog, not the first 24,000 characters of it
    expect(sentBodies[1].messages[0].content).toContain(`"id":"${last.id}"`)
  })

  test("CHAT_TOOLS=off keeps the old single call", async () => {
    vi.stubEnv("CHAT_TOOLS", "off")
    const { sentBodies } = await ask("hello", [sse([text("Hi there!")])])
    expect(sentBodies).toHaveLength(1)
    expect(sentBodies[0].tools).toBeUndefined()
  })
})
