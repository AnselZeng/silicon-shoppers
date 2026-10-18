"use client"

import type { ReactNode } from "react"
import { Slider } from "@/components/ui/slider"
import { applyMix, MIX_CATEGORIES, MIX_DEPARTMENTS, MIX_SECTIONS, rebalance } from "@/lib/model/mix"
import type { HomepageDoc } from "@/lib/model/homepage"

function shareOf(map: Record<string, number> | undefined, key: string): number {
  const value = map?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function SliderRow({
  label,
  share,
  onChange,
}: {
  label: string
  share: number
  onChange: (next: number) => void
}) {
  const pct = Math.round(share * 100)
  return (
    <label className="grid grid-cols-[5.75rem_1fr_2rem] items-center gap-2 text-[11px] text-white/80">
      <span>{label}</span>
      <Slider
        min={0}
        max={100}
        value={[pct]}
        onValueChange={(next) => {
          const raw = Array.isArray(next) ? next[0] : next
          if (typeof raw === "number") onChange(Math.round(raw) / 100)
        }}
      />
      <span className="text-right tabular-nums text-white/45">{pct}%</span>
    </label>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] tracking-[0.14em] text-white/40 uppercase">{title}</p>
      {children}
    </div>
  )
}

/** Editable predicted mix. Moving a slider rewrites the layout decisions Run sends to the store. */
export function PredictedMix({ doc, onChange }: { doc: HomepageDoc; onChange: (doc: HomepageDoc) => void }) {
  const mix = doc.predicted_mix
  const colors = doc.layout.color_highlight.value

  function setGroup(group: "department" | "category", key: string, next: number) {
    const keys = group === "department" ? MIX_DEPARTMENTS.map((item) => item.key) : MIX_CATEGORIES.map((item) => item.key)
    const current = mix[group] as Record<string, number>
    const balanced = rebalance(current, keys, key, next)
    onChange(
      applyMix({
        ...doc,
        predicted_mix: { ...mix, [group]: balanced },
      }),
    )
  }

  function setSection(key: string, next: number) {
    onChange(
      applyMix({
        ...doc,
        predicted_mix: { ...mix, section: { ...mix.section, [key]: Math.min(1, Math.max(0, next)) } },
      }),
    )
  }

  function setBrowsing(key: "exploration" | "multi_visit_research", next: number) {
    onChange(
      applyMix({
        ...doc,
        browsing: { ...doc.browsing, [key]: Math.min(1, Math.max(0, next)) },
      }),
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      <Group title="Departments">
        {MIX_DEPARTMENTS.map((item) => (
          <SliderRow
            key={item.key}
            label={item.label}
            share={shareOf(mix.department, item.key)}
            onChange={(next) => setGroup("department", item.key, next)}
          />
        ))}
      </Group>
      <Group title="Categories">
        {MIX_CATEGORIES.map((item) => (
          <SliderRow
            key={item.key}
            label={item.label}
            share={shareOf(mix.category, item.key)}
            onChange={(next) => setGroup("category", item.key, next)}
          />
        ))}
      </Group>
      <Group title="Sections">
        {MIX_SECTIONS.map((item) => (
          <SliderRow
            key={item.key}
            label={item.label}
            share={shareOf(mix.section, item.key)}
            onChange={(next) => setSection(item.key, next)}
          />
        ))}
      </Group>
      <Group title="Colors">
        <p className="text-[11px] text-white/75">{colors.length > 0 ? colors.join(", ") : "No highlight"}</p>
      </Group>
      <Group title="Browsing">
        <SliderRow label="Exploring" share={doc.browsing.exploration} onChange={(next) => setBrowsing("exploration", next)} />
        <SliderRow label="Comes back" share={doc.browsing.multi_visit_research} onChange={(next) => setBrowsing("multi_visit_research", next)} />
      </Group>
    </div>
  )
}
