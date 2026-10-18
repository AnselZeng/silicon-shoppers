"use client"

import type { HomepageDoc } from "@/lib/model/homepage"
import type { StoreLayoutDoc } from "@/lib/model/storeLayout"

const DECISIONS = [
  "landing_department",
  "category_order",
  "section_order",
  "default_sort",
  "hero",
  "color_highlight",
  "price_filter_first",
  "filter_order",
  "grid_columns",
  "popups",
] as const

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
  const meta = (doc.model_meta ?? {}) as Partial<HomepageDoc>
  const changed = Object.entries(doc.layout).filter(([, decision]) => decision.changed)
  const persona = doc.shopper.persona?.name ?? doc.shopper.label
  const bags = meta.evidence?.add_to_bags
  const events = meta.evidence?.events
  return (
    <div className="mt-3 text-[11px]">
      <p className="text-[10px] tracking-[0.14em] text-white/40 uppercase">
        Stored document · {persona}
        {doc.shopper.confidence ? ` · ${doc.shopper.confidence}` : ""} · {events ?? 0} events · {bags ?? 0}{" "}
        add-to-bags · {meta.store_products?.length ?? 0} ranked products
      </p>
      {doc.shopper.persona_reason ? <p className="mt-1 text-white/75">{doc.shopper.persona_reason}</p> : null}
      <ul className="mt-1 flex flex-col gap-1">
        {changed.length === 0 ? (
          <li className="text-white/55">No layout field has moved off the store default yet.</li>
        ) : (
          changed.map(([key, decision]) => (
            <li key={key} className="leading-snug">
              <span className="text-white/45">{key}</span> <span className="text-white">{show(decision.value)}</span>{" "}
              <span className="text-[#c4b5fd]">{decision.source}</span>{" "}
              <span className="text-white/70">{decision.reason}</span>
            </li>
          ))
        )}
      </ul>
      {meta.predicted_mix ? (
        <p className="mt-2 text-white/45">
          Predicted mix: <span className="text-white/80">{top(meta.predicted_mix.department, 2)}</span> ·{" "}
          <span className="text-white/80">{top(meta.predicted_mix.category)}</span> ·{" "}
          <span className="text-white/80">{top(meta.predicted_mix.section, 4)}</span>
        </p>
      ) : null}
      <details className="mt-2" open>
        <summary className="cursor-pointer text-white/45">Raw JSON · from the laptop</summary>
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
  basket,
  stored,
}: {
  doc: HomepageDoc
  basket: string[]
  stored?: StoreLayoutDoc | null
}) {
  if (stored) return <StoredOutput doc={stored} />
  return (
    <div className="mt-3 text-[11px]">
      <p className="text-[10px] tracking-[0.14em] text-white/40 uppercase">
        Fixture stand-in · not from the laptop · {doc.evidence?.add_to_bags ?? basket.length} add-to-bags ·{" "}
        {doc.store_products?.length ?? 0} ranked products
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {DECISIONS.map((key) => {
          const decision = doc.layout[key]
          return (
            <li key={key} className="leading-snug">
              <span className="text-white/45">{key}</span> <span className="text-white">{show(decision.value)}</span>{" "}
              <span className="text-[#c4b5fd]">
                {decision.class}
                {decision.validated ? " · validated" : ""}
              </span>{" "}
              <span className="text-white/70">{decision.reason}</span>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-white/45">
        Predicted mix: <span className="text-white/80">{top(doc.predicted_mix.department, 2)}</span> ·{" "}
        <span className="text-white/80">{top(doc.predicted_mix.category)}</span> ·{" "}
        <span className="text-white/80">{top(doc.predicted_mix.section, 4)}</span>
      </p>
      <details className="mt-2" open>
        <summary className="cursor-pointer text-white/45">Raw JSON · hand-written fixture</summary>
        <pre className="mt-1 max-h-64 overflow-auto bg-black/40 p-2 text-[10px] leading-snug text-white/80">
          {JSON.stringify(doc, null, 2)}
        </pre>
      </details>
    </div>
  )
}
