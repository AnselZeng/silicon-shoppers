"use client"

import type { HomepageDoc } from "@/lib/model/homepage"
import type { StoreLayoutDoc } from "@/lib/model/storeLayout"

const STORY: (keyof HomepageDoc["layout"])[] = [
  "landing_department",
  "section_order",
  "default_sort",
  "hero",
  "color_highlight",
  "popups",
]

function show(value: unknown): string {
  if (Array.isArray(value)) return value.slice(0, 4).join(" > ") || "none"
  if (value && typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function top(shares: Record<string, number> | undefined, n = 3): string {
  if (!shares) return "none"
  return Object.entries(shares)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, share]) => `${key.replace(/^(cat|dept)_/, "")} ${Math.round(share * 100)}%`)
    .join(" · ")
}

function StoredOutput({ doc }: { doc: StoreLayoutDoc }) {
  const changed = Object.entries(doc.layout).filter(([, decision]) => decision.changed)
  const persona = doc.shopper.persona?.name ?? doc.shopper.label
  return (
    <div className="mt-3 text-[11px]">
      <p className="text-[10px] tracking-[0.14em] text-white/40 uppercase">
        Stored layout · {persona}
        {doc.shopper.confidence ? ` · ${doc.shopper.confidence} confidence` : ""}
      </p>
      {doc.shopper.persona_reason ? <p className="mt-1 text-white/80">{doc.shopper.persona_reason}</p> : null}
      <ul className="mt-2 flex flex-col gap-1">
        {changed.length === 0 ? (
          <li className="text-white/55">Nothing has moved off the default store yet.</li>
        ) : (
          changed.slice(0, 8).map(([key, decision]) => (
            <li key={key} className="leading-snug text-white/80">
              {decision.reason || show(decision.value)}
            </li>
          ))
        )}
      </ul>
      <details className="mt-2">
        <summary className="cursor-pointer text-white/45">Stored JSON</summary>
        <pre className="mt-1 max-h-64 overflow-auto bg-black/40 p-2 text-[10px] leading-snug text-white/80">
          {JSON.stringify(doc, null, 2)}
        </pre>
      </details>
    </div>
  )
}

/** The model's output. `stored` is the Snowflake document; otherwise `doc` is a hand-written fixture. */
export function ModelOutput({
  doc,
  stored,
  exampleName,
}: {
  doc: HomepageDoc
  basket: string[]
  stored?: StoreLayoutDoc | null
  exampleName?: string
}) {
  if (stored) return <StoredOutput doc={stored} />
  return (
    <div className="mt-3 text-[11px]">
      <p className="text-[10px] tracking-[0.14em] text-white/40 uppercase">
        What Run applies{exampleName ? ` · ${exampleName}` : ""}
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {STORY.map((key) => (
          <li key={key} className="leading-snug text-white/80">
            {doc.layout[key].reason}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-white/45">
        Mix <span className="text-white/80">{top(doc.predicted_mix.department, 2)}</span>
        {" · "}
        <span className="text-white/80">{top(doc.predicted_mix.section, 3)}</span>
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-white/45">Example JSON</summary>
        <pre className="mt-1 max-h-64 overflow-auto bg-black/40 p-2 text-[10px] leading-snug text-white/80">
          {JSON.stringify(doc, null, 2)}
        </pre>
      </details>
    </div>
  )
}
