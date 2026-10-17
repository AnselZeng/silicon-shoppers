"use client"

import { useEffect } from "react"
import { PERSONA_ACCENTS } from "@/config/ui"
import { TraitEditor } from "@/components/shell/TraitEditor"
import { previewLayout } from "@/lib/layout/preview"
import { PERSONA_LABEL } from "@/lib/personas/schema"
import { postSimMessage } from "@/lib/sim/protocol"
import { usePersonaStore } from "@/lib/state/personaStore"
import { useSimStore } from "@/lib/state/simStore"
import { ScrollArea } from "@/components/ui/scroll-area"

export function PersonaPanel() {
  const personas = usePersonaStore((state) => state.personas)
  const selectedId = usePersonaStore((state) => state.selectedId)
  const select = usePersonaStore((state) => state.select)
  const layoutPreview = useSimStore((state) => state.layoutPreview)
  const setLayoutPreview = useSimStore((state) => state.setLayoutPreview)
  const iframe = useSimStore((state) => state.iframe)
  const status = useSimStore((state) => state.status)
  const selected = personas.find((persona) => persona.id === selectedId) ?? personas[0]

  useEffect(() => {
    if (!iframe?.contentWindow) return
    if (status === "running" || status === "paused") return
    const { layout, presetName } = previewLayout(layoutPreview, usePersonaStore.getState().personas)
    postSimMessage(iframe.contentWindow, {
      type: "set_layout",
      layout,
      presetName: presetName ?? undefined,
    })
  }, [iframe, layoutPreview, status])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
        <div>
          <p className="text-[10px] tracking-[0.22em] text-white/40 uppercase">Refit</p>
          <h1 className="text-sm font-medium">Shopper personas</h1>
        </div>
        <p className="text-[10px] text-white/40">Click to refit the store</p>
      </div>
      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={() => setLayoutPreview("default")}
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
      <div className="grid grid-cols-2 gap-2 px-4">
        {personas.map((persona) => {
          const accent = PERSONA_ACCENTS[persona.baseId]
          const active = layoutPreview === persona.id
          return (
            <button
              key={persona.id}
              type="button"
              onClick={() => {
                select(persona.id)
                setLayoutPreview(persona.id)
              }}
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
      <p className="px-4 pt-2 text-[10px] leading-relaxed text-white/40">
        Same wordmark, type, and palette. The page changes sort, filters, hero, and how color is shown.
      </p>
      <ScrollArea className="mt-2 min-h-0 flex-1 px-4 pb-3">
        {selected ? <TraitEditor persona={selected} /> : null}
      </ScrollArea>
    </div>
  )
}
