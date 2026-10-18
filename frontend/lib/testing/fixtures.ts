import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { FixtureEntry } from "@/lib/model/fixtures"
import type { HomepageDoc, ModelContext } from "@/lib/model/homepage"

/** Test-only: read the fixtures from disk. */

const DIR = join(__dirname, "../../public/model/fixtures")

function read<T>(file: string): T {
  return JSON.parse(readFileSync(join(DIR, file), "utf8")) as T
}

export function fixtureEntries(): FixtureEntry[] {
  return read<{ fixtures: FixtureEntry[] }>("index.json").fixtures
}

export function fixtureModel(id: string): ModelContext {
  const entry = fixtureEntries().find((item) => item.id === id)
  if (!entry) throw new Error(`no fixture ${id}`)
  return { doc: read<HomepageDoc>(entry.doc), basketIds: entry.basket }
}

export function fixtureLlm(id: string): unknown {
  const entry = fixtureEntries().find((item) => item.id === id)
  if (!entry?.llm) throw new Error(`no LLM output for ${id}`)
  return read<unknown>(entry.llm)
}
