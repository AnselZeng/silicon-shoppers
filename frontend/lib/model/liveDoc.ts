import { isStoreLayoutDoc } from "@/lib/model/adapter"
import { getShopperId } from "@/lib/model/eventSink"
import type { HomepageDoc } from "@/lib/model/homepage"
import { applyMix } from "@/lib/model/mix"
import type { StoreLayoutDoc } from "@/lib/model/storeLayout"

export interface LiveFetch {
  state: "disabled" | "waiting" | "live" | "error"
  shopperId: string
  updatedAt: string | null
  doc: StoreLayoutDoc | HomepageDoc | null
  trending: { productId: string; score: number }[]
}

/** The document Snowflake has for this browser, or why there isn't one. */
export async function fetchLiveLayout(): Promise<LiveFetch> {
  const shopperId = getShopperId()
  try {
    const res = await fetch(`/api/layout?userId=${encodeURIComponent(shopperId)}`)
    const body = (await res.json()) as {
      homepage?: unknown
      updatedAt?: string | null
      disabled?: boolean
      trending?: { productId?: string; score?: number }[]
    }
    const trending = (body.trending ?? [])
      .filter((item) => typeof item.productId === "string")
      .map((item) => ({ productId: item.productId as string, score: Number(item.score ?? 0) }))
    if (body.disabled) return { state: "disabled", shopperId, updatedAt: null, doc: null, trending }
    if (!body.homepage || typeof body.homepage !== "object") {
      return { state: "waiting", shopperId, updatedAt: body.updatedAt ?? null, doc: null, trending }
    }
    return {
      state: "live",
      shopperId,
      updatedAt: body.updatedAt ?? null,
      doc: body.homepage as StoreLayoutDoc | HomepageDoc,
      trending,
    }
  } catch {
    return { state: "error", shopperId, updatedAt: null, doc: null, trending: [] }
  }
}

function metaOf(doc: StoreLayoutDoc): Partial<HomepageDoc> | null {
  const meta = doc.model_meta
  if (!meta || typeof meta !== "object") return null
  return meta as Partial<HomepageDoc>
}

/** Slider draft whose mix numbers are the ones stored on the laptop's document. */
export function draftFromLive(base: HomepageDoc, stored: StoreLayoutDoc): HomepageDoc | null {
  const meta = metaOf(stored)
  if (!meta?.predicted_mix) return null
  const colors = stored.layout.color_highlight?.value
  return applyMix({
    ...base,
    user_id: stored.shopper.id,
    evidence: meta.evidence ?? base.evidence,
    store_products: meta.store_products ?? base.store_products,
    predicted_mix: meta.predicted_mix,
    browsing: meta.browsing ?? base.browsing,
    layout: {
      ...base.layout,
      color_highlight: {
        ...base.layout.color_highlight,
        value: Array.isArray(colors) ? colors : base.layout.color_highlight.value,
      },
    },
  })
}

export function sameMix(a: HomepageDoc["predicted_mix"], b: HomepageDoc["predicted_mix"]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
