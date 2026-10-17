"use client"

import { PERSONA_ACCENTS } from "@/config/ui"
import { TraitEditor } from "@/components/shell/TraitEditor"
import { PERSONA_LABEL } from "@/lib/personas/schema"
import { usePersonaStore } from "@/lib/state/personaStore"
import { ScrollArea } from "@/components/ui/scroll-area"

export function PersonaPanel() {
  const personas = usePersonaStore((state) => state.personas)
  const selectedId = usePersonaStore((state) => state.selectedId)
  const select = usePersonaStore((state) => state.select)
  const selected = personas.find((persona) => persona.id === selectedId) ?? personas[0]

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
        <div>
          <p className="text-[10px] tracking-[0.22em] text-white/40 uppercase">Refit</p>
          <h1 className="text-sm font-medium">Shopper personas</h1>
        </div>
        <p className="text-[10px] text-white/40">Edits apply to the next run</p>
      </div>
      <div className="grid grid-cols-2 gap-2 px-4">
        {personas.map((persona) => {
          const accent = PERSONA_ACCENTS[persona.baseId]
          const active = persona.id === selectedId
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
      <ScrollArea className="mt-3 min-h-0 flex-1 px-4 pb-3">
        {selected ? <TraitEditor persona={selected} /> : null}
      </ScrollArea>
    </div>
  )
}
