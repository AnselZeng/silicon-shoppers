"use client"

import { useState } from "react"
import type { ConciergeTone } from "@/lib/layout/types"
import { emitStoreEvent } from "@/lib/store/emit"
import { useStorefront } from "@/lib/store/storeState"

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

export function Concierge() {
  const enabled = useStorefront((state) => state.layout.concierge.enabled)
  const tone = useStorefront((state) => state.layout.concierge.tone)
  const open = useStorefront((state) => state.conciergeOpen)
  const footer = useStorefront((state) => state.stickyFooterOpen)
  const setOpen = useStorefront((state) => state.setConciergeOpen)
  const answer = useStorefront((state) => state.conciergeAnswer)
  const setAnswer = useStorefront((state) => state.setConciergeAnswer)
  const [asked, setAsked] = useState<string | null>(null)
  if (!enabled) return null
  const script = SCRIPTS[tone]
  return (
    <div className={`fixed right-4 z-40 w-72 ${footer ? "bottom-20" : "bottom-4"}`}>
      {open ? (
        <div className="mb-2 border border-[#141414] bg-[#f6f3ee] p-3 shadow-lg">
          <p className="text-[10px] tracking-[0.2em] uppercase">Concierge · {tone}</p>
          <div className="mt-2 flex flex-col gap-1">
            {script.map((item) => (
              <button
                key={item.q}
                type="button"
                onClick={() => {
                  setAsked(item.q)
                  setAnswer(item.a)
                  emitStoreEvent("concierge_query", { tone, q: item.q })
                }}
                className="text-left text-sm underline-offset-2 hover:underline"
              >
                {item.q}
              </button>
            ))}
          </div>
          {answer ? <p className="mt-3 text-sm leading-relaxed">{answer}</p> : null}
          {asked ? null : null}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="bg-[#141414] px-4 py-2 text-[11px] tracking-[0.18em] text-white uppercase"
      >
        {open ? "Close concierge" : "Concierge"}
      </button>
    </div>
  )
}
