// node session_model/web/check.mjs [dir]  -> verifies the JS runtime matches the Python model on exported fixtures.
// dir defaults to this folder (where `python -m session_model export` writes); smoke runs use session_model/work/smoke/web.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sessionFeatures, predictStyle, decide } from "./sessionStyle.js";

const here = process.argv[2] || dirname(fileURLToPath(import.meta.url));
const model = JSON.parse(readFileSync(join(here, "session_model.json"), "utf8"));
const cases = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));

let bad = 0;
const close = (a, b, tol) => (a === null || Number.isNaN(a) ? b === null || Number.isNaN(b) : Math.abs(a - b) <= tol);
for (const [i, c] of cases.entries()) {
  const x = sessionFeatures(c.events, model.visit_gap_s);
  x.forEach((v, j) => {
    if (!close(c.features[j], v, 1e-9)) { bad++; console.error(`case ${i} feature ${model.features[j]}: py ${c.features[j]} js ${v}`); }
  });
  const style = predictStyle(model, x);
  for (const [t, v] of Object.entries(c.style)) {
    if (!close(v, style[t], 1e-6)) { bad++; console.error(`case ${i} ${t}: py ${v} js ${style[t]}`); }
  }
  const d = decide(model, style, c.events.length);
  for (const [k, v] of Object.entries(c.decisions)) {
    if (d[k].value !== v.value || d[k].active !== v.active) { bad++; console.error(`case ${i} ${k}: py ${JSON.stringify(v)} js ${JSON.stringify(d[k])}`); }
  }
}
console.log(bad ? `FAILED: ${bad} mismatches` : `OK: JS runtime matches Python on ${cases.length} fixtures`);
process.exit(bad ? 1 : 0);
