"use client"

import { PERSONA_ACCENTS } from "@/config/ui"
import { TraitEditor } from "@/components/shell/TraitEditor"
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
  const selected = personas.find((persona) => persona.id === selectedId) ?? personas[0]

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
        <div>
          <p className="text-[10px] tracking-[0.22em] text-white/40 uppercase">Refit</p>
          <h1 className="text-sm font-medium">Layout preview</h1>
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
      <p className="px-4 pt-2 text-[10px] tracking-[0.14em] text-white/40 uppercase">Personas</p>
      <div className="grid grid-cols-2 gap-2 px-4 pt-1">
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
      <ScrollArea className="mt-2 min-h-0 flex-1 px-4 pb-3">
        {selected ? <TraitEditor persona={selected} /> : null}
      </ScrollArea>
    </div>
  )
}
