// Regenerates docs/design-guideline.md from lib/layout/guideline.ts.
// Run: npm run guideline

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { designGuideline } from "@/lib/layout/guideline"

const out = join(process.cwd(), "../docs/design-guideline.md")
writeFileSync(out, designGuideline())
console.log(`wrote ${out}`)
