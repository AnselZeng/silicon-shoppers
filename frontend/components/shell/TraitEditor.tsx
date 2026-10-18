"use client"

import { COLOR_HEX, STORE_COLORS, type StoreColor } from "@/config/ui"
import { Slider } from "@/components/ui/slider"
import { usePersonaStore } from "@/lib/state/personaStore"
import type { Persona, PersonaTraits } from "@/lib/personas/schema"

function priceWord(level: number): string {
  if (level < 34) return "Budget"
  if (level < 67) return "Mid"
  return "Premium"
}

function SliderRow({
  label,
  value,
  min = 0,
  max = 100,
  readout,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  readout: string
  onChange: (value: number) => void
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px] text-white/80">
      <span>{label}</span>
      <span className="tabular-nums text-white/50">{readout}</span>
      <Slider
        className="col-span-2"
        min={min}
        max={max}
        value={[value]}
        onValueChange={(next) => {
          const raw = Array.isArray(next) ? next[0] : next
          if (typeof raw === "number") onChange(Math.round(raw))
        }}
      />
    </label>
  )
}

export function TraitEditor({ persona }: { persona: Persona }) {
  const updateTraits = usePersonaStore((state) => state.updateTraits)
  const traits = persona.traits
  const patch = (next: Partial<PersonaTraits>) => updateTraits(persona.id, next)

  return (
    <div className="flex flex-col gap-3 pb-4">
      <SliderRow
        label="Menswear"
        value={traits.menShare}
        readout={`${traits.menShare}% men`}
        onChange={(value) => patch({ menShare: value })}
      />
      <SliderRow
        label="Sale buys"
        value={traits.saleShare}
        readout={`${traits.saleShare}%`}
        onChange={(value) => patch({ saleShare: value })}
      />
      <SliderRow
        label="New arrivals"
        value={traits.newShare}
        readout={`${traits.newShare}%`}
        onChange={(value) => patch({ newShare: value })}
      />
      <SliderRow
        label="Price level"
        value={traits.priceLevel}
        readout={priceWord(traits.priceLevel)}
        onChange={(value) => patch({ priceLevel: value })}
      />
      <SliderRow
        label="Basket size"
        value={traits.basketSize}
        min={3}
        max={20}
        readout={`${traits.basketSize} items`}
        onChange={(value) => patch({ basketSize: value })}
      />
      <div>
        <p className="mb-1 text-[11px] text-white/70">Colors</p>
        <div className="flex flex-wrap gap-1 py-1 pl-1">
          {STORE_COLORS.map((color) => {
            const on = traits.colorPreference.includes(color)
            return (
              <button
                key={color}
                type="button"
                aria-pressed={on}
                title={color}
                onClick={() => {
                  const next: StoreColor[] = on
                    ? traits.colorPreference.filter((item) => item !== color)
                    : [...traits.colorPreference, color]
                  patch({ colorPreference: next })
                }}
                className={`size-5 rounded-full border ${on ? "ring-2 ring-white ring-offset-1 ring-offset-[#0c0c0d]" : "border-white/20"}`}
                style={{ background: COLOR_HEX[color] }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
