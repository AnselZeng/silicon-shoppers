"use client"

import { useLogStore } from "@/lib/state/logStore"
import { useObsStore } from "@/lib/state/obsStore"

type SentryLike = {
  setContext?: (name: string, context: Record<string, unknown> | null) => void
}

export function hasSentryDsn(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN)
}

function importSentry(): Promise<SentryLike> {
  const specifier = ["@sentry", "nextjs"].join("/")
  const load = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<SentryLike>
  return load(specifier)
}

export function setRunContext(ctx: { personaId: string; seed: number; runId: string }) {
  useObsStore.getState().setContext(ctx)
  useObsStore.getState().note(`run ${ctx.runId} · persona ${ctx.personaId} · seed ${ctx.seed}`)
  useLogStore.getState().push("sentry", `local stub · run context ${ctx.personaId} seed ${ctx.seed}`)
  if (!hasSentryDsn()) return
  void importSentry()
    .then((sentry) => {
      sentry.setContext?.("simulation", ctx)
    })
    .catch(() => {
      useLogStore.getState().push("sentry", "DSN set but @sentry/nextjs is not installed")
    })
}

export function withSpan<T>(
  name: string,
  fn: () => T,
  data?: Record<string, string | number | boolean>,
): T {
  const id = useObsStore.getState().startSpan(name, data)
  if (!hasSentryDsn() && (name === "layout.adapt" || name.startsWith("visa.") || name === "simulation.run")) {
    useLogStore.getState().push("sentry", `local stub · span ${name}`)
  }
  try {
    const result = fn()
    useObsStore.getState().endSpan(id, "ok")
    return result
  } catch (error) {
    useObsStore.getState().endSpan(id, "error")
    throw error
  }
}
