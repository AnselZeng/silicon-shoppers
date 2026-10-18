"use client"

import { PERSONA_ACCENTS } from "@/config/ui"
import { TraitEditor } from "@/components/shell/TraitEditor"
import { intrusiveCount } from "@/lib/ads/placement"
import { previewId } from "@/lib/layout/preview"
import { PERSONA_LABEL } from "@/lib/personas/schema"
import { runner } from "@/lib/sim/runner"
import { usePersonaStore } from "@/lib/state/personaStore"
import { useSimStore } from "@/lib/state/simStore"
import { ScrollArea } from "@/components/ui/scroll-area"

export function PersonaPanel() {
  const personas = usePersonaStore((state) => state.personas)
  const selectedId = usePersonaStore((state) => state.selectedId)
  const select = usePersonaStore((state) => state.select)
  const layoutPreview = useSimStore((state) => state.layoutPreview)
  const fixtures = useSimStore((state) => state.fixtures)
  const preview = useSimStore((state) => state.preview)
  const selected = personas.find((persona) => persona.id === selectedId) ?? personas[0]

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
        <div>
          <p className="text-[10px] tracking-[0.22em] text-white/40 uppercase">Silicon Shoppers</p>
          <h1 className="text-sm font-medium">Layout preview</h1>
          <p className="text-[10px] text-white/40">Default, then the model layout, then the LLM layout</p>
        </div>
      </div>
      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={() => runner.preview("default")}
          className="w-full border px-2 py-2 text-left"
          style={{
            borderColor: layoutPreview === "default" ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.12)",
            background: layoutPreview === "default" ? "rgba(255,255,255,0.06)" : "transparent",
          }}
        >
          <span className="block text-[10px] tracking-[0.14em] text-white/50 uppercase">House default</span>
          <span className="block text-sm">One storefront for everyone</span>
        </button>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-4 pb-3">
        <p className="pt-1 text-[10px] tracking-[0.14em] text-white/40 uppercase">Model output fixtures</p>
        <div className="mt-1 flex flex-col gap-1">
          {fixtures.map((fixture) => (
            <div key={fixture.id} className="flex items-center gap-2 border border-white/12 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm">{fixture.label}</span>
                <span className="block truncate text-[10px] text-white/45">{fixture.description}</span>
              </div>
              {(["model", "llm"] as const).map((stage) => {
                const id = previewId(fixture.id, stage)
                return (
                  <button
                    key={stage}
                    type="button"
                    disabled={stage === "llm" && !fixture.llm}
                    onClick={() => runner.preview(id)}
                    className={`border px-2 py-1 text-[10px] tracking-[0.12em] uppercase disabled:opacity-30 ${
                      layoutPreview === id ? "border-white bg-white text-black" : "border-white/20 text-white/80"
                    }`}
                  >
                    {stage === "llm" ? "LLM" : "Model"}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        {preview ? (
          <div className="mt-3">
            <p className="text-[10px] tracking-[0.14em] text-white/40 uppercase">
              {preview.label} · {intrusiveCount(preview.layout)} intrusive ads
              {preview.report.changes.length > 0 ? ` · ${preview.report.changes.length} validator fixes` : ""}
              {preview.report.fellBack ? " · fell back" : ""}
            </p>
            <ul className="mt-1 flex flex-col gap-1 text-[11px]">
              {preview.layout.reasons.map((reason) => (
                <li key={reason.field} className="leading-snug">
                  <span className="text-white/45">{reason.field}</span>{" "}
                  <span className={reason.source === "llm" ? "text-[#fde047]" : "text-[#c4b5fd]"}>
                    {reason.source === "llm" ? "LLM" : reason.class ?? "model"}
                  </span>{" "}
                  <span className="text-white/85">{reason.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      <p className="pt-4 text-[10px] tracking-[0.14em] text-white/40 uppercase">Personas</p>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {personas.map((persona) => {
          const accent = PERSONA_ACCENTS[persona.baseId]
          const active = persona.id === selected?.id
          return (
            <button
              key={persona.id}
              type="button"
              onClick={() => select(persona.id)}
              className="border px-2 py-2 text-left"
              style={{
                borderColor: active ? accent : "rgba(255,255,255,0.12)",
                background: active ? `${accent}22` : "transparent",
              }}
            >
              <span className="block text-[10px] tracking-[0.14em] uppercase" style={{ color: accent }}>
                {persona.isCustom ? "Custom" : PERSONA_LABEL[persona.baseId]}
              </span>
              <span className="block truncate text-sm">{persona.name}</span>
            </button>
          )
        })}
      </div>
        <div className="mt-2">{selected ? <TraitEditor persona={selected} /> : null}</div>
      </ScrollArea>
    </div>
  )
}
