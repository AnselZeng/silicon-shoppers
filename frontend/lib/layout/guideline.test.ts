import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { AD_IDS } from "@/lib/ads/catalog"
import { AD_SLOT_IDS } from "@/lib/ads/types"
import { designGuideline, layoutJsonSchema } from "@/lib/layout/guideline"
import { HomeBlockSchema } from "@/lib/layout/schema"

describe("design guideline", () => {
  const text = designGuideline()

  test("covers every ad, slot and block type", () => {
    for (const id of AD_IDS) expect(text).toContain(`\`${id}\``)
    for (const slot of AD_SLOT_IDS) expect(text).toContain(`\`${slot}\``)
    for (const option of HomeBlockSchema.options) expect(text).toContain(`\`${option.shape.type.value}\``)
  })

  test("the schema leaves out the fields code copies in", () => {
    const schema = layoutJsonSchema() as { properties: { home: { properties: object }; listing: { properties: object } } }
    expect(Object.keys(schema.properties.home.properties)).toEqual(["blocks", "heroSize"])
    expect(Object.keys(schema.properties.listing.properties)).not.toContain("categoryOrder")
  })

  test("docs/design-guideline.md is up to date (npm run guideline)", () => {
    // .gitattributes may check the doc out as CRLF on Windows; compare normalized.
    const doc = readFileSync(join(__dirname, "../../../docs/design-guideline.md"), "utf8").replace(/\r\n/g, "\n")
    expect(doc).toBe(text)
  })
})
