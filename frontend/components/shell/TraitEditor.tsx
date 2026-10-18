"use client"

import { COLOR_HEX, STORE_COLORS, type StoreColor } from "@/config/ui"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { usePersonaStore } from "@/lib/state/personaStore"
import type { DepartmentPref, Persona, PersonaTraits } from "@/lib/personas/schema"

function SliderRow({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px] text-white/80">
      <span>{label}</span>
      <span className="tabular-nums text-white/50">{value}</span>
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
      <Field label="Department">
        <EnumSelect
          value={traits.preferredDepartment}
          options={["women", "men", "both"]}
          onChange={(value) => patch({ preferredDepartment: value as DepartmentPref })}
        />
      </Field>
      <SliderRow label="Price sensitivity" value={traits.priceSensitivity} onChange={(value) => patch({ priceSensitivity: value })} />
      <SliderRow label="Max budget" value={traits.maxBudget} min={20} max={400} onChange={(value) => patch({ maxBudget: value })} />
      <SliderRow label="Novelty" value={traits.noveltySeeking} onChange={(value) => patch({ noveltySeeking: value })} />
      <div>
        <p className="mb-1 text-[11px] text-white/70">Colors</p>
        <div className="flex flex-wrap gap-1">
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
                  patch({ colorPreference: next.length > 0 ? next : [color] })
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-white/80">
      <span>{label}</span>
      {children}
    </label>
  )
}

function EnumSelect({
  value,
  options,
  onChange,
  labelFor,
}: {
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  labelFor?: (value: string) => string
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next)
      }}
    >
      <SelectTrigger size="sm" className="text-foreground">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {labelFor ? labelFor(option) : option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
