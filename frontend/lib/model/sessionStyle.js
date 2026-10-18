// Live session model runtime (no dependencies). Mirrors session_model/features.py and export.py exactly;
// `node session_model/web/check.mjs` verifies the two agree on real OTTO prefixes.
//
// Usage in the app:
//   import { SessionTracker } from "./sessionStyle.js";
//   const model = await (await fetch("/session_model.json")).json();
//   const tracker = new SessionTracker(model);
//   tracker.add({ ts: Date.now() / 1000, aid: productId, type: 0 });   // 0 click, 1 add to bag, 2 order
//   const { style, decisions } = tracker.current();
//   // decisions.grid_columns.value -> 2 | 3 | 4, decisions.compare_panel.value -> "on" | "off", ...
//   // decisions.X.active is false until the model is reliable for that many events.

const ZERO = 1e-35;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  const m = Math.floor(n / 2);
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const ratio = (a, b) => (b > 0 ? a / b : NaN);

export function sessionFeatures(events, visitGapS = 1800) {
  // events: [{ts, aid, type}] or [[ts, aid, type]]; sorted by (ts, type, aid) like the training data
  const ev = events
    .map((e) => (Array.isArray(e) ? e : [e.ts, e.aid, e.type]))
    .slice()
    .sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
  const n = ev.length;
  if (n === 0) return new Array(19).fill(NaN);
  let nClicks = 0, nCarts = 0, nOrders = 0, visit = 0, revisits = 0, repeats = 0;
  const gaps = [];
  const clickedPerVisit = new Map();
  const clickCount = new Map();
  const firstClick = new Map();
  const firstCart = new Map();
  const carted = new Set(), ordered = new Set();
  let prevTs = null, prevAid = null;
  for (const [ts, aid, typ] of ev) {
    if (prevTs !== null) {
      const dt = ts - prevTs;
      if (dt > visitGapS) visit += 1;
      else if (dt > 0) gaps.push(dt);
    }
    if (typ === 0) {
      nClicks += 1;
      const seen = clickCount.get(aid) || 0;
      if (seen > 0 && prevAid !== aid) revisits += 1;
      if (prevAid === aid) repeats += 1;
      clickCount.set(aid, seen + 1);
      if (!clickedPerVisit.has(visit)) clickedPerVisit.set(visit, new Set());
      clickedPerVisit.get(visit).add(aid);
      if (!firstClick.has(aid)) firstClick.set(aid, [ts, visit]);
    } else if (typ === 1) {
      nCarts += 1;
      carted.add(aid);
      if (!firstCart.has(aid)) firstCart.set(aid, [ts, visit]);
    } else {
      nOrders += 1;
      ordered.add(aid);
    }
    prevTs = ts;
    prevAid = aid;
  }
  const nVisits = visit + 1;
  const distinctItems = new Set(ev.map((e) => e[1])).size;
  const decide = [];
  const researched = [];
  for (const [a, [cts, cvisit]] of firstCart) {
    if (firstClick.has(a)) {
      const [fts, fvisit] = firstClick.get(a);
      if (fts <= cts) decide.push(cts - fts);
      if (fvisit < cvisit) researched.push(a);
    }
  }
  const explore = [...clickedPerVisit.values()].map((s) => s.size);
  let cartedClicked = 0;
  for (const a of carted) if (clickCount.has(a)) cartedClicked += 1;
  let cartedOrdered = 0;
  for (const a of carted) if (ordered.has(a)) cartedOrdered += 1;
  let logSum = 0;
  for (const g of gaps) logSum += Math.log1p(g);
  return [
    n, nClicks, nCarts, nOrders, nVisits, n / nVisits,
    distinctItems, ratio(clickCount.size, nClicks),
    explore.length ? explore.reduce((a, b) => a + b, 0) / explore.length : NaN,
    ratio(revisits, nClicks), ratio(repeats, nClicks),
    gaps.length ? Math.log1p(median(gaps)) : NaN,
    gaps.length ? logSum / gaps.length : NaN,
    Math.log1p(ev[n - 1][0] - ev[0][0]),
    n > 1 ? Math.log1p(Math.max(ev[n - 1][0] - ev[n - 2][0], 0)) : NaN,
    ratio(cartedClicked, clickCount.size),
    decide.length ? Math.log1p(median(decide)) : NaN,
    ratio(researched.length, carted.size),
    ratio(cartedOrdered, carted.size),
  ];
}

function goLeft(x, t, dl, mt) {
  if (Number.isNaN(x) && mt !== 2) x = 0;
  if ((mt === 1 && x >= -ZERO && x <= ZERO) || (mt === 2 && Number.isNaN(x))) return dl === 1;
  return x <= t;
}

function treeValue(tr, x) {
  let node = tr.root;
  while (node >= 0) {
    node = goLeft(x[tr.f[node]], tr.t[node], tr.dl[node], tr.mt[node]) ? tr.l[node] : tr.r[node];
  }
  return tr.v[~node];
}

export function predictStyle(model, x) {
  const out = {};
  for (const [tgt, m] of Object.entries(model.targets)) {
    let s = 0;
    for (const tr of m.trees) s += treeValue(tr, x);
    out[tgt] = Math.min(1, Math.max(0, s));
  }
  return out;
}

function reliableR2(model, target, nEvents) {
  const byN = model.targets[target].r2_by_events;
  const ok = Object.keys(byN).map(Number).filter((k) => k <= nEvents);
  return ok.length ? byN[String(Math.max(...ok))] : 0;
}

export function decide(model, style, nEvents) {
  const out = {};
  for (const rule of model.policy) {
    const weak = rule.targets.filter((t) => reliableR2(model, t, nEvents) < model.min_r2);
    if (weak.length) {
      out[rule.decision] = { value: rule.default, active: false, reason: `Not enough signal yet from ${nEvents} events` };
      continue;
    }
    const hit = rule.cases.find((c) =>
      Object.entries(c.when).every(([t, [lo, hi]]) => lo <= style[t] && style[t] < hi));
    out[rule.decision] = hit
      ? { value: hit.value, active: true, reason: hit.reason }
      : { value: rule.default, active: false, reason: "Store default" };
  }
  return out;
}

export class SessionTracker {
  constructor(model) {
    this.model = model;
    this.events = [];
  }
  add(event) {
    this.events.push(event);
    return this.current();
  }
  current() {
    const x = sessionFeatures(this.events, this.model.visit_gap_s);
    const style = predictStyle(this.model, x);
    return { nEvents: this.events.length, style, decisions: decide(this.model, style, this.events.length) };
  }
}
