"use client"

import { useEffect, useState } from "react"
import { isStoreLayoutDoc } from "@/lib/model/adapter"
import { fetchCohort, type CohortSnapshot } from "@/lib/model/cohort"
import type { HomepageDoc } from "@/lib/model/homepage"
import { fetchLiveLayout, type LiveFetch } from "@/lib/model/liveDoc"
import type { StoreLayoutDoc } from "@/lib/model/storeLayout"
import { useSimStore } from "@/lib/state/simStore"

function show(value: unknown): string {
  if (Array.isArray(value)) return value.slice(0, 3).join(" / ") || "none"
  if (value && typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="grid grid-cols-[5.5rem_1fr] gap-2">
      <span className="text-white/40">{label}</span>
      <span className="break-all text-white/85">{value}</span>
    </li>
  )
}

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

function storedRows(doc: StoreLayoutDoc): { label: string; value: string }[] {
  const meta = (doc.model_meta ?? {}) as Partial<HomepageDoc>
  const changed = Object.entries(doc.layout).filter(([, decision]) => decision.changed)
  const mix = meta.predicted_mix?.department
  const topDept = mix
    ? Object.entries(mix)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([key, share]) => `${key.replace(/^dept_/, "")} ${Math.round(share * 100)}%`)
        .join(" · ")
    : ""
  const products = (meta.store_products ?? []).slice(0, 6).map((item) => item.product_id).join(", ")
  return [
    { label: "Persona", value: `${doc.shopper.persona?.name ?? doc.shopper.label} (${doc.shopper.confidence})` },
    { label: "Reason", value: doc.shopper.persona_reason || "none yet" },
    { label: "Events", value: `${meta.evidence?.events ?? 0} events · ${meta.evidence?.add_to_bags ?? 0} add-to-bags` },
    { label: "Mix", value: topDept || "none" },
    { label: "Changed", value: changed.length ? changed.map(([key, decision]) => `${key}=${show(decision.value)}`).join(" · ") : "still the store default" },
    { label: "Products", value: products || "none ranked" },
  ]
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
  const rows =
    live?.state === "live" && live.doc && isStoreLayoutDoc(live.doc)
      ? storedRows(live.doc)
      : live?.state === "live" && live.doc
        ? [{ label: "Document", value: "Older homepage shape, not a v1 layout." }]
        : []
  const members = cohort?.personas.reduce((sum, persona) => sum + persona.members, 0) ?? 0

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto pr-1 text-[11px]">
      <p className={status.tone}>
        <span className="tracking-[0.14em] uppercase">{status.title}</span>
        <span className="mt-0.5 block text-white/70">{status.detail}</span>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <p className="mb-1 text-[10px] tracking-[0.14em] text-white/40 uppercase">This browser</p>
          <ul className="flex flex-col gap-1">
            <Row label="Shopper" value={live?.shopperId ?? "…"} />
            <Row label="Checked" value={checkedAt || "…"} />
            <Row label="Updated" value={live?.updatedAt || "no layout"} />
            {rows.map((row) => (
              <Row key={row.label} label={row.label} value={row.value} />
            ))}
          </ul>
        </section>
        <section>
          <p className="mb-1 text-[10px] tracking-[0.14em] text-white/40 uppercase">
            Four types{members > 0 ? ` · ${count(members)} shoppers` : ""}
          </p>
          {cohort?.state === "ready" ? (
            <ul className="flex flex-col gap-1">
              {cohort.personas.map((persona) => (
                <li key={persona.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-white/85">{persona.name}</span>
                  <span className="shrink-0 text-right text-white/55">
                    {count(persona.members)} · {Math.round(persona.highConfidence * 100)}% high
                  </span>
                </li>
              ))}
              <Row label="Events" value={count(cohort.events)} />
              <Row label="Layouts" value={count(cohort.layouts)} />
              <Row label="Catalog" value={count(cohort.catalog)} />
              <Row
                label="Trending"
                value={
                  live?.trending.length
                    ? live.trending
                        .slice(0, 6)
                        .map((item) => `${item.productId} ${item.score}`)
                        .join(", ")
                    : cohort.trending > 0
                      ? count(cohort.trending)
                      : "none right now"
                }
              />
            </ul>
          ) : (
            <p className="text-white/55">
              {cohort?.state === "error"
                ? "The cohort read failed."
                : cohort?.state === "disabled"
                  ? "Snowflake is off, so the cohort counts are hidden."
                  : "Reading the four types…"}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
