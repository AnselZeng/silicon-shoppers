"use client"

import { useEffect, useRef, useState } from "react"
import { PERSONA_ACCENTS } from "@/config/ui"
import { ModelOutput } from "@/components/shell/ModelOutput"
import { TraitEditor } from "@/components/shell/TraitEditor"
import { Button } from "@/components/ui/button"
import { DEMO_SHOPPERS, shopperFromSentence } from "@/lib/layout/demoShoppers"
import { loadFixture } from "@/lib/model/fixtures"
import type { HomepageDoc } from "@/lib/model/homepage"
import { runner } from "@/lib/sim/runner"
import { useLogStore } from "@/lib/state/logStore"
import { usePersonaStore } from "@/lib/state/personaStore"
import { useSimStore } from "@/lib/state/simStore"
import { ScrollArea } from "@/components/ui/scroll-area"

export function PersonaPanel() {
  const personas = usePersonaStore((state) => state.personas)
  const selectedId = usePersonaStore((state) => state.selectedId)
  const select = usePersonaStore((state) => state.select)
  const layoutPreview = useSimStore((state) => state.layoutPreview)
  const preview = useSimStore((state) => state.preview)
  const fixtures = useSimStore((state) => state.fixtures)
  const [sentence, setSentence] = useState("")
  const [busy, setBusy] = useState(false)
  const runToken = useRef(0)
  const previousPreview = useRef("default")
  const finishTimer = useRef<number | null>(null)
  const [modelDoc, setModelDoc] = useState<HomepageDoc | null>(null)
  const [basket, setBasket] = useState<string[]>([])

  const selected = DEMO_SHOPPERS.find((shopper) => shopper.id === selectedId) ?? DEMO_SHOPPERS[0]
  const fromSentence = shopperFromSentence(sentence)
  const active = fromSentence ?? selected
  const persona = personas.find((item) => item.id === active.id) ?? personas[0]
  const onDefault = layoutPreview === "default" || layoutPreview === ""

  useEffect(() => {
    const entry = fixtures.find((item) => item.id === active.fixtureId)
    if (!entry) return
    let cancel = false
    void loadFixture(entry).then((fixture) => {
      if (cancel || !fixture) return
      setModelDoc(fixture.doc)
      setBasket(entry.basket)
    })
    return () => {
      cancel = true
    }
  }, [active.fixtureId, fixtures])

  async function run() {
    if (fixtures.length === 0 || busy) return
    const token = ++runToken.current
    previousPreview.current = useSimStore.getState().layoutPreview || "default"
    setBusy(true)
    const started = Date.now()
    if (persona) select(persona.id)
    useLogStore.getState().push("sim", `running ${active.title}`)
    await runner.preview(`shopper:${active.fixtureId}`)
    if (runToken.current !== token) return
    const remaining = 1600 - (Date.now() - started)
    finishTimer.current = window.setTimeout(() => {
      if (runToken.current === token) setBusy(false)
    }, Math.max(0, remaining))
  }

  function stop() {
    if (!busy) return
    runToken.current += 1
    if (finishTimer.current !== null) window.clearTimeout(finishTimer.current)
    setBusy(false)
    void runner.stop(previousPreview.current)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4 pb-3">
        <p className="text-[10px] tracking-[0.22em] text-white/40 uppercase">Silicon Shoppers</p>
        <h1 className="mt-1 text-sm font-medium">Refit the store for one shopper</h1>
      </div>
      <div className="px-4">
        <button
          type="button"
          onClick={() => runner.preview("default")}
          className="w-full border px-3 py-2 text-left"
          style={{
            borderColor: onDefault ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.12)",
            background: onDefault ? "rgba(255,255,255,0.06)" : "transparent",
          }}
        >
          <span className="block text-[10px] tracking-[0.14em] text-white/50 uppercase">Default website</span>
          <span className="block text-sm">The store everyone gets</span>
        </button>
      </div>
      <ScrollArea className="mt-3 min-h-0 flex-1 px-4">
        <p className="text-[10px] tracking-[0.14em] text-white/40 uppercase">Who’s shopping</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {DEMO_SHOPPERS.map((shopper) => {
            const accent = PERSONA_ACCENTS[shopper.id]
            const picked = shopper.id === selected.id && !fromSentence
            return (
              <button
                key={shopper.id}
                type="button"
                onClick={() => {
                  select(shopper.id)
                  setSentence("")
                }}
                className="border px-2 py-2 text-left"
                style={{
                  borderColor: picked ? accent : "rgba(255,255,255,0.12)",
                  background: picked ? `${accent}22` : "transparent",
                }}
              >
                <span className="block text-[10px] tracking-[0.14em] uppercase" style={{ color: accent }}>
                  {shopper.title}
                </span>
              </button>
            )
          })}
        </div>
        <ul className="mt-3 space-y-1 text-[12px] leading-snug text-white/75">
          {active.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {persona ? (
          <div className="mt-3">
            <p className="mb-2 text-[10px] tracking-[0.14em] text-white/40 uppercase">Preferences</p>
            <TraitEditor persona={persona} />
          </div>
        ) : null}
        <label className="mt-4 block text-[10px] tracking-[0.14em] text-white/40 uppercase">
          Or describe them
          <textarea
            value={sentence}
            onChange={(event) => setSentence(event.target.value)}
            rows={2}
            placeholder="Buys menswear on sale and skips popups"
            className="mt-1 w-full resize-none border border-white/15 bg-transparent px-2 py-2 text-[12px] tracking-normal text-white normal-case outline-none placeholder:text-white/30"
          />
        </label>
        {fromSentence ? (
          <p className="mt-1 text-[11px] text-white/55">Closest shopper: {fromSentence.title}</p>
        ) : null}
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            className="h-10 flex-1 bg-white text-sm text-black hover:bg-neutral-200 disabled:bg-white/80 disabled:text-black disabled:opacity-100"
            disabled={fixtures.length === 0 || busy}
            aria-busy={busy}
            onClick={() => void run()}
          >
            {busy ? "Running…" : "Run"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 border-white/30 bg-transparent px-4 text-white hover:bg-white/10 disabled:opacity-40"
            disabled={!busy}
            onClick={stop}
          >
            Stop
          </Button>
        </div>
        {modelDoc ? <ModelOutput doc={preview?.doc ?? modelDoc} basket={preview?.basket ?? basket} /> : null}
        <div className="h-4" />
      </ScrollArea>
    </div>
  )
}
