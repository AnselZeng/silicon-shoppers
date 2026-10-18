import type { HomepageDoc } from "@/lib/model/homepage"

/** Hand-written stand-ins for model (and LLM) output, served from public/model/fixtures/. */

export interface FixtureEntry {
  id: string
  label: string
  description: string
  doc: string
  basket: string[]
  llm: string | null
}

export interface Fixture {
  entry: FixtureEntry
  doc: HomepageDoc
  /** Hand-written LLM output, when the fixture has one. */
  llm: unknown | null
}

const BASE = "/model/fixtures"

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BASE}/${path}`)
  if (!res.ok) return null
  return (await res.json()) as T
}

export async function loadFixtureIndex(): Promise<FixtureEntry[]> {
  const index = await getJson<{ fixtures: FixtureEntry[] }>("index.json")
  return index?.fixtures ?? []
}

const cache = new Map<string, Promise<Fixture | null>>()

export function loadFixture(entry: FixtureEntry): Promise<Fixture | null> {
  const cached = cache.get(entry.id)
  if (cached) return cached
  const next = (async () => {
    const doc = await getJson<HomepageDoc>(entry.doc)
    if (!doc) return null
    const llm = entry.llm ? await getJson<unknown>(entry.llm) : null
    return { entry, doc, llm }
  })()
  cache.set(entry.id, next)
  return next
}
