"use client"

import { useEffect, useState } from "react"
import { isStoreLayoutDoc } from "@/lib/model/adapter"
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
    <li className="grid grid-cols-[6.5rem_1fr] gap-2">
      <span className="text-white/40">{label}</span>
      <span className="break-all text-white/85">{value}</span>
    </li>
  )
}

function statusCopy(live: LiveFetch | null): { tone: string; title: string; detail: string } {
  if (!live) return { tone: "text-white/50", title: "Checking", detail: "Asking /api/layout for this browser." }
  if (live.state === "disabled") {
    return {
      tone: "text-[#fdba74]",
      title: "Not connected",
      detail: "Snowflake is off, so nothing is pulled. The store is on the fixture.",
    }
  }
  if (live.state === "error") {
    return { tone: "text-[#fca5a5]", title: "Pull failed", detail: "The layout request did not succeed." }
  }
  if (live.state === "waiting") {
    return {
      tone: "text-[#fde68a]",
      title: "Connected, no document yet",
      detail: "Clicks are uploading. A document shows up after the laptop's next refresh.",
    }
  }
  return {
    tone: "text-[#86efac]",
    title: "Pulled",
    detail: "This list is the document stored for this browser.",
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

export function BackendPanel() {
  const liveRevision = useSimStore((state) => state.liveRevision)
  const [live, setLive] = useState<LiveFetch | null>(null)
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

  const status = statusCopy(live)
  const rows =
    live?.state === "live" && live.doc && isStoreLayoutDoc(live.doc)
      ? storedRows(live.doc)
      : live?.state === "live" && live.doc
        ? [{ label: "Document", value: "Older homepage shape, not a v1 layout." }]
        : []

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto pr-1 text-[11px]">
      <p className={status.tone}>
        <span className="tracking-[0.14em] uppercase">{status.title}</span>
        <span className="mt-0.5 block text-white/70">{status.detail}</span>
      </p>
      <ul className="flex flex-col gap-1">
        <Row label="Shopper" value={live?.shopperId ?? "…"} />
        <Row label="Checked" value={checkedAt || "…"} />
        <Row label="Updated" value={live?.updatedAt || "no document"} />
        {rows.map((row) => (
          <Row key={row.label} label={row.label} value={row.value} />
        ))}
        <Row
          label="Trending"
          value={
            live?.trending.length
              ? live.trending
                  .slice(0, 6)
                  .map((item) => item.productId)
                  .join(", ")
              : "none"
          }
        />
      </ul>
    </div>
  )
}
