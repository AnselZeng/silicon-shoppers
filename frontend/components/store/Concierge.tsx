"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import type { ConciergeTone } from "@/lib/layout/types"
import { buildChatContext } from "@/lib/store/chatContext"
import { applyChatIntent } from "@/lib/store/chatIntent"
import { runChatActions, splitActions } from "@/lib/store/agent"
import { emitStoreEvent } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"

// Suggested starters per concierge tone — also the offline fallback answers when no LLM
// key is configured (the bubble still works, it just can't chat freely).
const SCRIPTS: Record<ConciergeTone, { q: string; a: string }[]> = {
  deals: [
    {
      q: "What's under $75?",
      a: "The rib tee is $22, the fine tank $26, the everyday crew $29. The straight trouser is $72.",
    },
    {
      q: "Any extra off at checkout?",
      a: "Sale prices are already the offer. Guest express checkout won't add a fee.",
    },
    {
      q: "Which sale colors are black?",
      a: "Rib tee, everyday crew, column skirt, and the straight trouser all come in black.",
    },
  ],
  drops: [
    {
      q: "What just landed?",
      a: "The Winter Puffer Jacket, the bias slip dress, and a merino polo in burgundy.",
    },
    {
      q: "Tell me about the puffer.",
      a: "Short hem, matte shell, black or cream. $180. It's the hero of the Winter Edit.",
    },
    {
      q: "Which color should I take?",
      a: "Black if you already live in the edit. Cream if you want it to read as new.",
    },
  ],
  mission: [
    {
      q: "Find a navy shirt in M.",
      a: "The men's oxford comes in navy, white, and black. Size M is in stock. $88.",
    },
    {
      q: "Something for work?",
      a: "Wool trouser in navy, oxford shirt, no logos. Both are in Essentials.",
    },
    {
      q: "Is the size true?",
      a: "Shirts are true to size. If you are between sizes, stay with M.",
    },
  ],
  loyalty: [
    {
      q: "What's new in Essentials?",
      a: "The column coat and the wool trouser are the keepers. Same block as last winter.",
    },
    {
      q: "How do points work?",
      a: "One point per dollar on loyalty pay. This demo awards them when you check out.",
    },
    {
      q: "Will you restock the coat?",
      a: "The column coat stays in Essentials. Black, camel, and navy.",
    },
  ],
}

interface Msg {
  role: "user" | "assistant"
  content: string
}

export function Concierge() {
  const router = useRouter()
  // Always available to shoppers — tone still comes from the applied layout.
  const tone = useStorefront((state) => state.layout.concierge.tone)
  const open = useStorefront((state) => state.conciergeOpen)
  const footer = useStorefront((state) => state.stickyFooterOpen)
  const setOpen = useStorefront((state) => state.setConciergeOpen)
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const history = useRef<Msg[]>([])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, open])

  const script = SCRIPTS[tone]

  const scriptedAnswer = (q: string) => script.find((item) => item.q === q)?.a ?? null

  async function send(raw: string) {
    const message = raw.trim()
    if (!message || busy) return
    setBusy(true)
    setDraft("")
    emitStoreEvent("concierge_query", { tone, q: message })
    // A stated preference the store can act on is applied right away — the shopper asked
    // out loud, so no confidence gate. The reply below is then told what changed.
    const applied = applyChatIntent(message, useStorefront.getState().layout)
    if (applied) {
      useStorefront.getState().setLayout(applied.layout, { presetName: applied.summary })
      emitStoreEvent("concierge_layout", { tone, summary: applied.summary })
    }
    setMessages((prev) => [...prev, { role: "user", content: message }])
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: history.current.slice(-10),
          context: {
            ...buildChatContext(),
            ...(applied ? { applied: { summary: applied.summary, changes: applied.changes } } : {}),
          },
        }),
      })
      if (!res.ok) throw new Error(`chat ${res.status}`)
      const reader = res.body?.pipeThrough(new TextDecoderStream()).getReader()
      if (!reader) throw new Error("no stream")
      let reply = ""
      let buffer = ""
      const asked = Date.now()
      setMessages((prev) => [...prev, { role: "assistant", content: "" }])
      for (;;) {
        const { done, value } = await reader.read()
        buffer += value ?? ""
        const lines = buffer.split("\n")
        buffer = done ? "" : (lines.pop() ?? "")
        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as { type: string; text?: string; error?: string; model?: string; ms?: number }
          if (event.type === "delta" && event.text) {
            reply += event.text
            // The trailing <<<ACTIONS>>> block is machine-readable; never render it.
            const shown = splitActions(reply).text
            setMessages((prev) => [...prev.slice(0, -1), { role: "assistant", content: shown }])
          }
          if (event.type === "error") throw new Error(event.error)
          if (event.type === "done") {
            emitStoreEvent("concierge_reply", {
              tone,
              model: event.model ?? "unknown",
              ms: event.ms ?? Date.now() - asked,
              chars: reply.length,
            })
          }
        }
        if (done) break
      }
      const { text, actions } = splitActions(reply)
      if (!text) throw new Error("empty reply")
      if (actions.length) runChatActions(actions, router.push)
      history.current = [...history.current, { role: "user" as const, content: message }, { role: "assistant" as const, content: text }].slice(-12)
    } catch (error) {
      emitStoreEvent("concierge_error", { tone, error: error instanceof Error ? error.message : "failed" })
      const fallback =
        scriptedAnswer(message) ??
        (applied
          ? `Done! ${applied.summary}.`
          : "The concierge is offline right now, but the store is still learning from everything you click.")
      setOffline(true)
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === "assistant" && !last.content) return [...prev.slice(0, -1), { role: "assistant" as const, content: fallback }]
        return [...prev, { role: "assistant" as const, content: fallback }]
      })
      history.current = [...history.current, { role: "user" as const, content: message }, { role: "assistant" as const, content: fallback }].slice(-12)
    }
    setBusy(false)
  }

  return (
    <div className={`fixed right-4 z-40 w-72 ${footer ? "bottom-20" : "bottom-4"}`}>
      {open ? (
        <div className="mb-2 flex h-80 flex-col border border-[#141414] bg-[#f6f3ee] shadow-lg">
          <p className="border-b border-[#141414]/15 px-3 py-2 text-[10px] tracking-[0.2em] uppercase">
            Concierge · {tone}{offline ? " · offline" : ""}
          </p>
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-1 pt-1">
                {script.map((item) => (
                  <button
                    key={item.q}
                    type="button"
                    onClick={() => void send(item.q)}
                    className="text-left text-sm underline-offset-2 hover:underline"
                  >
                    {item.q}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((msg, i) => (
                <p
                  key={i}
                  className={
                    msg.role === "user"
                      ? "ml-8 bg-[#141414] px-2 py-1.5 text-right text-[13px] leading-snug text-white"
                      : "mr-8 border border-[#141414]/20 bg-white px-2 py-1.5 text-[13px] leading-snug"
                  }
                >
                  {msg.content || "…"}
                </p>
              ))
            )}
            {busy ? <p className="mr-8 text-[11px] text-black/40">typing…</p> : null}
          </div>
          <form
            className="flex border-t border-[#141414]/15"
            onSubmit={(event) => {
              event.preventDefault()
              void send(draft)
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              suppressHydrationWarning
              placeholder="Ask about the store…"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
            />
            <button type="submit" disabled={busy || !draft.trim()} className="px-3 text-[11px] uppercase tracking-[0.14em] disabled:opacity-30">
              Send
            </button>
          </form>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="ml-auto block rounded-full bg-[#141414] px-3 py-1.5 text-[10px] tracking-[0.14em] text-white uppercase shadow-md"
      >
        {open ? "Close" : "Concierge"}
      </button>
    </div>
  )
}
