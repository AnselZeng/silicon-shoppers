"use client"

import { useEffect, useState } from "react"
import { isStoreLayoutDoc } from "@/lib/model/adapter"
import { fetchCohort, type CohortSnapshot } from "@/lib/model/cohort"
import type { HomepageDoc } from "@/lib/model/homepage"
import { fetchLiveLayout, type LiveFetch } from "@/lib/model/liveDoc"
import type { StoreLayoutDoc } from "@/lib/model/storeLayout"
import { useSimStore } from "@/lib/state/simStore"

function statusCopy(live: LiveFetch | null): { tone: string; title: string; detail: string } {
  if (!live) return { tone: "text-white/50", title: "Checking", detail: "Asking for this browser's layout." }
  if (live.state === "disabled") {
    return {
      tone: "text-[#fdba74]",
      title: "Not connected",
      detail: "Snowflake is off. The store is running the examples.",
    }
  }
  if (live.state === "error") {
    return { tone: "text-[#fca5a5]", title: "Pull failed", detail: "The layout request did not succeed." }
  }
  if (live.state === "waiting") {
    return {
      tone: "text-[#fde68a]",
      title: "Connected, no layout yet",
      detail: "Clicks are uploading. A layout appears after the laptop's next refresh.",
    }
  }
  return {
    tone: "text-[#86efac]",
    title: "Pulled",
    detail: "This is the layout stored for this browser.",
  }
}

function shortId(id: string): string {
  if (id.length <= 16) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

/** Persona and event count. Mix, reasons, and product ids already sit on the left. */
function liveSummary(doc: StoreLayoutDoc): string {
  const meta = (doc.model_meta ?? {}) as Partial<HomepageDoc>
  const name = doc.shopper.persona?.name ?? doc.shopper.label
  const events = meta.evidence?.events ?? 0
  const bags = meta.evidence?.add_to_bags ?? 0
  return `${name}, ${doc.shopper.confidence} · ${events.toLocaleString("en-US")} events · ${bags} add-to-bags`
}

function count(n: number): string {
  return n.toLocaleString("en-US")
}

export function BackendPanel() {
  const liveRevision = useSimStore((state) => state.liveRevision)
  const [live, setLive] = useState<LiveFetch | null>(null)
  const [cohort, setCohort] = useState<CohortSnapshot | null>(null)
  const [checkedAt, setCheckedAt] = useState<string>("")

  useEffect(() => {
    let cancel = false
    const load = () => {
      void fetchLiveLayout().then((next) => {
        if (cancel) return
        setLive(next)
        setCheckedAt(new Date().toLocaleTimeString())
      })
    }
    load()
    const timer = window.setInterval(load, 10000)
    return () => {
      cancel = true
      window.clearInterval(timer)
    }
  }, [liveRevision])

  useEffect(() => {
    let cancel = false
    const load = () => {
      void fetchCohort().then((next) => {
        if (!cancel) setCohort(next)
      })
    }
    load()
    const timer = window.setInterval(load, 30000)
    return () => {
      cancel = true
      window.clearInterval(timer)
    }
  }, [])

  const status = statusCopy(live)
  const summary =
    live?.state === "live" && live.doc && isStoreLayoutDoc(live.doc)
      ? liveSummary(live.doc)
      : live?.state === "live" && live.doc
        ? "Older homepage shape."
        : status.detail
  const updated = live?.updatedAt ? live.updatedAt.split(" ")[1]?.replace(/\.\d+$/, "") || live.updatedAt : ""
  const members = cohort?.personas.reduce((sum, persona) => sum + persona.members, 0) ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-3 overflow-auto text-[11px]">
      <div>
        <p className={status.tone}>
          <span className="tracking-[0.14em] uppercase">{status.title}</span>
          <span className="text-white/75"> · {summary}</span>
        </p>
        <p className="mt-1 text-white/40">
          {live ? shortId(live.shopperId) : "…"}
          {checkedAt ? ` · checked ${checkedAt}` : ""}
          {updated ? ` · updated ${updated}` : ""}
        </p>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] tracking-[0.14em] text-white/40 uppercase">
          Four types{members > 0 ? ` · ${count(members)} shoppers` : ""}
        </p>
        {cohort?.state === "ready" ? (
          <>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              {cohort.personas.map((persona) => (
                <li key={persona.id} className="min-w-0">
                  <p className="truncate text-white/85">{persona.name}</p>
                  <p className="text-white/50">
                    {count(persona.members)} · {Math.round(persona.highConfidence * 100)}% high
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-white/40">
              {count(cohort.events)} events · {count(cohort.layouts)} layouts
            </p>
          </>
        ) : (
          <p className="text-white/55">
            {cohort?.state === "error"
              ? "The cohort read failed."
              : cohort?.state === "disabled"
                ? "Snowflake is off, so the cohort counts are hidden."
                : "Reading the four types…"}
          </p>
        )}
      </div>
    </div>
  )
}
