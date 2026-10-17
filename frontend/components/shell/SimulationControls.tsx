"use client"

import { useState } from "react"
import { PERSONA_ACCENTS } from "@/config/ui"
import { ObservabilityPanel } from "@/components/shell/ObservabilityPanel"
import { Terminal } from "@/components/shell/Terminal"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PERSONA_LABEL } from "@/lib/personas/schema"
import { randomSeed } from "@/lib/sim/rng"
import { runner } from "@/lib/sim/runner"
import { usePersonaStore } from "@/lib/state/personaStore"
import { useSimStore, type SimSpeed } from "@/lib/state/simStore"

const SPEEDS: SimSpeed[] = [0.5, 1, 2, 4]

export function SimulationControls() {
  const status = useSimStore((state) => state.status)
  const speed = useSimStore((state) => state.speed)
  const seed = useSimStore((state) => state.seed)
  const adaptive = useSimStore((state) => state.adaptive)
  const inference = useSimStore((state) => state.inference)
  const selectedId = usePersonaStore((state) => state.selectedId)
  const [tab, setTab] = useState("terminal")
  const [seedDraft, setSeedDraft] = useState(String(seed))
  const accent = inference.personaId ? PERSONA_ACCENTS[inference.personaId] : "#a3a3a3"
  const top = inference.personaId ? Math.round((inference.probabilities[inference.personaId] ?? 0) * 100) : 0

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" className="text-foreground" onClick={() => void runner.run(selectedId)}>
          Run
        </Button>
        <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={() => runner.pause()}>
          Pause
        </Button>
        <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={() => runner.resume()}>
          Resume
        </Button>
        <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={() => void runner.step()}>
          Step
        </Button>
        <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={() => runner.reset()}>
          Reset
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => runner.setSpeed(value)}
            className={`border px-2 py-1 ${speed === value ? "border-white bg-white text-black" : "border-white/20 text-white/80"}`}
          >
            {value}x
          </button>
        ))}
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            runner.setSeed(Number(seedDraft))
          }}
        >
          <span className="text-white/50">Seed</span>
          <input
            value={seedDraft}
            onChange={(event) => setSeedDraft(event.target.value)}
            className="w-20 border border-white/20 bg-transparent px-2 py-1 text-white"
          />
        </form>
        <button
          type="button"
          className="border border-white/20 px-2 py-1 text-white/80"
          onClick={() => {
            const next = randomSeed()
            setSeedDraft(String(next))
            runner.setSeed(next)
          }}
        >
          Shuffle
        </button>
        <label className="ml-auto flex items-center gap-2 text-white/80">
          Adaptive
          <Switch checked={adaptive} onCheckedChange={(checked) => runner.setAdaptive(Boolean(checked))} />
        </label>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="border border-white/15 px-2 py-1 tracking-[0.14em] uppercase">{status}</span>
        <span style={{ color: accent }}>
          {inference.classified && inference.personaId
            ? `${PERSONA_LABEL[inference.personaId]} ${top}%`
            : inference.eventCount > 0
              ? `listening · ${inference.eventCount} events`
              : "unclassified"}
        </span>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
        <TabsList variant="line" className="bg-transparent">
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="obs">Observability</TabsTrigger>
        </TabsList>
        <TabsContent value="terminal" className="min-h-0">
          <Terminal />
        </TabsContent>
        <TabsContent value="obs" className="min-h-0 overflow-auto">
          <ObservabilityPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
