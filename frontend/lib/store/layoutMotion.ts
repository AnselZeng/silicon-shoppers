"use client"

import { flushSync } from "react-dom"
import { LAYOUT_MOTION } from "@/config/ui"
import { layoutSteps } from "@/lib/layout/steps"
import { validateLayout } from "@/lib/layout/validate"
import type { ModelContext } from "@/lib/model/homepage"
import { useStorefront } from "@/lib/store/storeState"

export interface LayoutMotionHooks {
  onStep: (index: number, total: number, label: string) => void
  onSettled: () => void
}

let epoch = 0
let timer: number | null = null
let active: ViewTransition | null = null
let scrollFrame: number | null = null

function isSkippedTransition(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function logUnexpected(error: unknown) {
  if (!isSkippedTransition(error)) console.error(error)
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    timer = window.setTimeout(resolve, ms)
  })
}

/** Where a focus target sits, or null when it is already in view (or not on this page). */
function scrollTarget(focus: string | null): number | null {
  if (focus === null) return null
  const max = document.documentElement.scrollHeight - window.innerHeight
  let top = 0
  if (focus !== "top") {
    const el = [...document.querySelectorAll<HTMLElement>("[style]")].find((node) => node.style.viewTransitionName === focus)
    if (!el) return null
    const box = el.getBoundingClientRect()
    const visible = box.top >= LAYOUT_MOTION.scrollOffsetPx - 8 && box.top <= window.innerHeight * 0.55
    if (visible) return null
    top = window.scrollY + box.top - LAYOUT_MOTION.scrollOffsetPx
  }
  top = Math.max(0, Math.min(max, top))
  return Math.abs(top - window.scrollY) < 24 ? null : top
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/**
 * Scrolls so the audience sees the change before it plays; resolves when the scroll ends.
 * Hand-rolled because the browser's smooth scroll runs at a speed we can't set: longer
 * distances take longer, between scrollMinMs and scrollMaxMs.
 */
function scrollToFocus(focus: string | null): Promise<void> {
  const top = scrollTarget(focus)
  if (top === null) return Promise.resolve()
  const from = window.scrollY
  const distance = top - from
  const duration = Math.min(
    LAYOUT_MOTION.scrollMaxMs,
    LAYOUT_MOTION.scrollMinMs + Math.abs(distance) * LAYOUT_MOTION.scrollMsPerPx,
  )
  const run = epoch
  return new Promise((resolve) => {
    const started = performance.now()
    const tick = (now: number) => {
      if (run !== epoch) return resolve()
      const t = Math.min(1, (now - started) / duration)
      window.scrollTo(0, from + distance * easeInOutCubic(t))
      if (t < 1) scrollFrame = window.requestAnimationFrame(tick)
      else resolve()
    }
    scrollFrame = window.requestAnimationFrame(tick)
  })
}

/** Drops any stages still waiting and snaps a running transition to its end. */
export function cancelLayoutMotion() {
  epoch += 1
  if (timer !== null) window.clearTimeout(timer)
  timer = null
  if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame)
  scrollFrame = null
  delete document.documentElement.dataset.adSwap
  useStorefront.getState().setLayoutFlash({})
  active?.skipTransition()
  active = null
}

/**
 * Validates the layout once, then plays the swap in stages (see layoutSteps). Each stage
 * scrolls to where it lands, boxes what is about to change, plays the change in a view
 * transition with the box riding along, holds, then fades the box. After the last stage
 * the page returns to the top. flushSync makes React commit inside the transition
 * callback, so the browser's "after" snapshot shows the new stage.
 */
export function playLayout(
  raw: unknown,
  options: { model?: ModelContext | null; presetName?: string | null },
  hooks: LayoutMotionHooks,
) {
  cancelLayoutMotion()
  const run = epoch
  const { layout: target, report } = validateLayout(raw, { model: options.model })
  const final = { report, presetName: options.presetName ?? null }
  const steps = layoutSteps(useStorefront.getState().layout, target)
  const start = document.startViewTransition?.bind(document)

  if (steps.length === 0 || prefersReducedMotion()) {
    useStorefront.getState().showLayoutStep(target, final)
    hooks.onSettled()
    return
  }

  const root = document.documentElement.style
  root.setProperty("--layout-step-ms", `${LAYOUT_MOTION.animMs}ms`)
  root.setProperty("--layout-fade-ms", `${LAYOUT_MOTION.fadeMs}ms`)
  root.setProperty("--layout-lead-ms", `${LAYOUT_MOTION.leadMs}ms`)

  /** Resolves false once a newer swap (or a cancel) has taken over. */
  const pause = async (ms: number) => {
    await waitMs(ms)
    return run === epoch
  }

  const play = async () => {
    for (const [index, step] of steps.entries()) {
      const last = index === steps.length - 1
      hooks.onStep(index + 1, steps.length, step.label)
      await scrollToFocus(step.focus)
      if (run !== epoch) return
      const boxed = Object.keys(step.flash).length > 0
      if (boxed) {
        useStorefront.getState().setLayoutFlash(step.flash)
        if (!(await pause(LAYOUT_MOTION.leadMs))) return
      }
      const apply = () => flushSync(() => useStorefront.getState().showLayoutStep(step.layout, last ? final : undefined))
      if (start) {
        // Read by globals.css before the old snapshot is taken: these slots play the replace animation.
        if (step.adSwaps.length > 0) document.documentElement.dataset.adSwap = step.adSwaps.join(" ")
        const transition = start(apply)
        active = transition
        transition.ready.catch(logUnexpected)
        await transition.finished.catch(logUnexpected)
        if (run !== epoch) return
        active = null
        delete document.documentElement.dataset.adSwap
      } else {
        apply()
      }
      if (boxed) {
        if (!(await pause(LAYOUT_MOTION.holdMs))) return
        useStorefront.getState().fadeLayoutFlash()
        if (!(await pause(LAYOUT_MOTION.fadeMs))) return
        useStorefront.getState().setLayoutFlash({})
      } else if (!(await pause(LAYOUT_MOTION.gapMs))) {
        return
      }
    }
    await scrollToFocus("top")
    if (run !== epoch) return
    hooks.onSettled()
  }
  void play()
}

/** Applies a layout in one frame, cancelling any swap in progress. */
export function applyLayoutNow(raw: unknown, options: { model?: ModelContext | null; presetName?: string | null }) {
  cancelLayoutMotion()
  useStorefront.getState().setLayout(raw, options)
}
