"use client"

import type { HomepageDoc } from "@/lib/model/homepage"

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
  return Array.isArray(value) ? value.join(" > ") || "none" : String(value)
}

function top(shares: Record<string, number>, n = 3): string {
  return Object.entries(shares)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, share]) => `${key.replace(/^(cat|dept)_/, "")} ${Math.round(share * 100)}%`)
    .join(" · ")
}

/** The model's output as the LLM will read it. It doesn't change the store. */
export function ModelOutput({ doc, basket }: { doc: HomepageDoc; basket: string[] }) {
  return (
    <div className="mt-3 text-[11px]">
      <p className="text-[10px] tracking-[0.14em] text-white/40 uppercase">
        Model output · input for the LLM · {doc.evidence?.add_to_bags ?? basket.length} add-to-bags ·{" "}
        {doc.store_products?.length ?? 0} ranked products
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {DECISIONS.map((key) => {
          const decision = doc.layout[key]
          return (
            <li key={key} className="leading-snug">
              <span className="text-white/45">{key}</span>{" "}
              <span className="text-white">{show(decision.value)}</span>{" "}
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
        <summary className="cursor-pointer text-white/45">Raw JSON</summary>
        <pre className="mt-1 max-h-64 overflow-auto bg-black/40 p-2 text-[10px] leading-snug text-white/80">
          {JSON.stringify(doc, null, 2)}
        </pre>
      </details>
    </div>
  )
}
