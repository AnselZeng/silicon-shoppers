export interface CohortPersona {
  id: string
  name: string
  members: number
  highConfidence: number
}

export interface CohortSnapshot {
  state: "disabled" | "ready" | "error"
  personas: CohortPersona[]
  events: number
  layouts: number
  catalog: number
  trending: number
}

/** The four persona counts and the warehouse sizes, for the demo panels. */
export async function fetchCohort(): Promise<CohortSnapshot> {
  const empty = { personas: [], events: 0, layouts: 0, catalog: 0, trending: 0 }
  try {
    const res = await fetch("/api/cohort")
    const body = (await res.json()) as Partial<CohortSnapshot> & { disabled?: boolean; error?: string }
    if (!res.ok || body.error) return { state: "error", ...empty }
    if (body.disabled) return { state: "disabled", ...empty }
    return {
      state: "ready",
      personas: body.personas ?? [],
      events: body.events ?? 0,
      layouts: body.layouts ?? 0,
      catalog: body.catalog ?? 0,
      trending: body.trending ?? 0,
    }
  } catch {
    return { state: "error", ...empty }
  }
}
