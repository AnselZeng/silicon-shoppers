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

/** Smooth-scrolls so the audience sees the change before it plays; resolves when the scroll ends. */
function scrollToFocus(focus: string | null): Promise<void> {
  const top = scrollTarget(focus)
  if (top === null) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("scrollend", done)
      window.clearTimeout(fallback)
      resolve()
    }
    window.addEventListener("scrollend", done, { once: true })
    const fallback = window.setTimeout(done, LAYOUT_MOTION.scrollMs)
    window.scrollTo({ top, behavior: "smooth" })
  })
}

/** Drops any stages still waiting and snaps a running transition to its end. */
export function cancelLayoutMotion() {
  epoch += 1
  if (timer !== null) window.clearTimeout(timer)
  timer = null
  active?.skipTransition()
  active = null
}

/**
 * Validates the layout once, then plays the swap in stages (see layoutSteps), each
 * inside its own view transition. Before a stage, the page scrolls to where it lands;
 * after the last one it returns to the top. flushSync makes React commit inside the
 * transition callback, so the browser's "after" snapshot shows the new stage.
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
    useStorefront.getState().showLayoutStep(target, {}, final)
    hooks.onSettled()
    return
  }

  const interval = Math.min(LAYOUT_MOTION.maxStepMs, LAYOUT_MOTION.totalMs / steps.length)
  const animMs = Math.round(Math.min(LAYOUT_MOTION.maxAnimMs, interval - 80))
  document.documentElement.style.setProperty("--layout-step-ms", `${animMs}ms`)
  document.documentElement.style.setProperty("--layout-flash-ms", `${LAYOUT_MOTION.flashMs}ms`)

  const play = async (index: number) => {
    if (run !== epoch) return
    const step = steps[index]
    const last = index === steps.length - 1
    await scrollToFocus(step.focus)
    if (run !== epoch) return
    const apply = () =>
      flushSync(() => useStorefront.getState().showLayoutStep(step.layout, step.flash, last ? final : undefined))
    hooks.onStep(index + 1, steps.length, step.label)
    let finished: Promise<unknown> = Promise.resolve()
    if (start) {
      const transition = start(apply)
      active = transition
      transition.ready.catch(logUnexpected)
      finished = transition.finished.catch(logUnexpected)
    } else {
      apply()
    }
    if (!last) {
      await waitMs(interval)
      void play(index + 1)
      return
    }
    await finished
    if (run !== epoch) return
    active = null
    if (window.scrollY > 0) {
      await waitMs(LAYOUT_MOTION.flashMs / 2)
      if (run !== epoch) return
      await scrollToFocus("top")
      if (run !== epoch) return
    }
    hooks.onSettled()
  }
  void play(0)
}

/** Applies a layout in one frame, cancelling any swap in progress. */
export function applyLayoutNow(raw: unknown, options: { model?: ModelContext | null; presetName?: string | null }) {
  cancelLayoutMotion()
  useStorefront.getState().setLayout(raw, options)
}
