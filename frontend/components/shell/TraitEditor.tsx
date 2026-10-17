"use client"

import { useRef } from "react"
import { COLOR_HEX, STORE_COLORS, type StoreColor } from "@/config/ui"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useLogStore } from "@/lib/state/logStore"
import { usePersonaStore } from "@/lib/state/personaStore"
import {
  SORT_LABEL,
  SORT_OPTIONS,
  type BannerTrigger,
  type DepartmentPref,
  type FirstFilter,
  type Persona,
  type PersonaTraits,
  type SortOption,
} from "@/lib/personas/schema"

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
  const duplicate = usePersonaStore((state) => state.duplicate)
  const resetOne = usePersonaStore((state) => state.resetOne)
  const exportPersona = usePersonaStore((state) => state.exportPersona)
  const importPersona = usePersonaStore((state) => state.importPersona)
  const fileRef = useRef<HTMLInputElement>(null)
  const traits = persona.traits
  const patch = (next: Partial<PersonaTraits>) => updateTraits(persona.id, next)

  function download() {
    const blob = new Blob([exportPersona(persona.id)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${persona.id}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-3 pb-4">
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="xs" variant="outline" className="text-foreground" onClick={() => duplicate(persona.id)}>
          Duplicate
        </Button>
        <Button type="button" size="xs" variant="outline" className="text-foreground" onClick={download}>
          Export
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="text-foreground"
          onClick={() => fileRef.current?.click()}
        >
          Import
        </Button>
        <Button type="button" size="xs" variant="outline" className="text-foreground" onClick={() => resetOne(persona.id)}>
          Reset
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              const result = importPersona(String(reader.result ?? ""))
              useLogStore.getState().push("sim", result.ok ? `imported ${result.id}` : result.error)
            }
            reader.readAsText(file)
            event.target.value = ""
          }}
        />
      </div>
      <Field label="Department">
        <EnumSelect
          value={traits.preferredDepartment}
          options={["women", "men", "both"]}
          onChange={(value) => patch({ preferredDepartment: value as DepartmentPref })}
        />
      </Field>
      <Field label="Sort">
        <EnumSelect
          value={traits.defaultSortPreference}
          options={SORT_OPTIONS}
          labelFor={(value) => SORT_LABEL[value as SortOption]}
          onChange={(value) => patch({ defaultSortPreference: value as SortOption })}
        />
      </Field>
      <Field label="First filter">
        <EnumSelect
          value={traits.firstFilterUsed}
          options={["sale", "color", "size", "category", "collection", "none"]}
          onChange={(value) => patch({ firstFilterUsed: value as FirstFilter })}
        />
      </Field>
      <Field label="Banner">
        <EnumSelect
          value={traits.bannerTrigger}
          options={["discount", "new_drop", "collection", "any"]}
          onChange={(value) => patch({ bannerTrigger: value as BannerTrigger })}
        />
      </Field>
      <Field label="Size">
        <EnumSelect
          value={traits.sizePreference}
          options={["XS", "S", "M", "L", "XL"]}
          onChange={(value) => patch({ sizePreference: value })}
        />
      </Field>
      <SliderRow label="Price sensitivity" value={traits.priceSensitivity} onChange={(value) => patch({ priceSensitivity: value })} />
      <SliderRow label="Max budget" value={traits.maxBudget} min={20} max={400} onChange={(value) => patch({ maxBudget: value })} />
      <SliderRow label="Popup tolerance" value={traits.popupTolerance} onChange={(value) => patch({ popupTolerance: value })} />
      <SliderRow label="Banner click" value={traits.bannerClickRate} onChange={(value) => patch({ bannerClickRate: value })} />
      <SliderRow label="Scroll depth" value={traits.scrollDepth} onChange={(value) => patch({ scrollDepth: value })} />
      <SliderRow
        label="PDPs before bag"
        value={traits.productsViewedBeforeDecision}
        min={1}
        max={12}
        onChange={(value) => patch({ productsViewedBeforeDecision: value })}
      />
      <SliderRow label="Image vs text" value={traits.imageVsTextAttention} onChange={(value) => patch({ imageVsTextAttention: value })} />
      <SliderRow label="Search" value={traits.usesSearch} onChange={(value) => patch({ usesSearch: value })} />
      <SliderRow label="Wishlist" value={traits.usesWishlist} onChange={(value) => patch({ usesWishlist: value })} />
      <SliderRow label="Novelty" value={traits.noveltySeeking} onChange={(value) => patch({ noveltySeeking: value })} />
      <SliderRow label="Collection loyalty" value={traits.brandCollectionLoyalty} onChange={(value) => patch({ brandCollectionLoyalty: value })} />
      <SliderRow label="Patience" value={traits.sessionPatience} onChange={(value) => patch({ sessionPatience: value })} />
      <SliderRow label="Add-to-bag threshold" value={traits.addToCartThreshold} onChange={(value) => patch({ addToCartThreshold: value })} />
      <label className="flex items-center justify-between text-[11px]">
        Reads reviews
        <Switch checked={traits.readsReviews} onCheckedChange={(checked) => patch({ readsReviews: Boolean(checked) })} />
      </label>
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
