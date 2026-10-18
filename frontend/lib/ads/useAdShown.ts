"use client"

import { useEffect } from "react"
import type { AdId } from "@/lib/ads/catalog"
import type { AdSlotId } from "@/lib/ads/types"
import { emitStoreEvent } from "@/lib/store/emit"

/** Logs ad_shown once per mount for a static slot. */
export function useAdShown(slot: AdSlotId, id: AdId | undefined, kind?: string) {
  useEffect(() => {
    if (id) emitStoreEvent("ad_shown", { slot, adId: id, kind: kind ?? null })
  }, [slot, id, kind])
}
