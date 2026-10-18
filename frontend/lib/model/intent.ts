// "Tell the store what you're shopping for": turns one sentence into a structured shopping intent.
//
// The LLM (app/api/intent/route.ts) only fills this small, fixed schema; it never edits the layout.
// keywordIntent() produces the same shape without any API, used as the fallback (no key, timeout,
// offline demo) so the feature always works.

export const INTENT_DEPARTMENTS = [
  "dept_ladieswear",
  "dept_menswear",
  "dept_divided",
  "dept_sport",
  "dept_baby_children",
] as const;
export type IntentDepartment = (typeof INTENT_DEPARTMENTS)[number];

export const INTENT_PRIORITIES = ["price", "new", "classics", "popular", "none"] as const;
export type IntentPriority = (typeof INTENT_PRIORITIES)[number];

export interface IntentBudget {
  /** US dollars */
  amount: number;
  /** "per_item": every item should cost at most `amount` ("under $30"); "total": the whole basket ("spend $100"). */
  scope: "per_item" | "total";
}

export interface Intent {
  /** Departments the shopper asked for, most important first (max 3). Empty = no preference. */
  departments: IntentDepartment[];
  /** What matters most to them; "none" if they didn't say. */
  priority: IntentPriority;
  /** Spending limit they stated, or null if they didn't give a number. */
  budget: IntentBudget | null;
  /** Short phrase to show back to the shopper, e.g. "Kids' school basics on a budget". */
  summary: string;
  /** Who produced it: the LLM or the keyword fallback (show this in the Terminal). */
  source: "llm" | "keywords";
}

/** Same shape as QuizAnswers in layoutEngine.ts, so it can go straight into applyQuiz(). */
export interface IntentQuiz {
  departments?: string[];
  priority?: "price" | "new" | "classics" | "popular";
}

export function toQuiz(intent: Intent): IntentQuiz {
  return {
    departments: intent.departments.length ? [...intent.departments] : undefined,
    priority: intent.priority === "none" ? undefined : intent.priority,
  };
}

/**
 * Explicit layout overrides for a stated intent. A sentence the shopper typed is their own choice, so it is
 * applied directly (like the quiz), not gated by model confidence. Every override carries a reason.
 */
export interface IntentOverrides {
  landingDepartment?: IntentDepartment;
  /** Departments to move to the top of the department order, in this order. */
  departmentsFirst: IntentDepartment[];
  /** Extra departments to show as quick-access tiles. */
  quickAccess: IntentDepartment[];
  priceMode: boolean;
  /** Stated spending limit, for the budget meter, badges and Budget picks. */
  budget: IntentBudget | null;
  /** Homepage rail to move to the top. */
  sectionFirst?: "new_in" | "sale" | "bestsellers";
  reason: string;
}

export function intentOverrides(intent: Intent): IntentOverrides {
  const [first, ...rest] = intent.departments;
  const sectionFirst =
    intent.priority === "new" ? "new_in"
      : intent.priority === "price" ? "sale"
      : intent.priority === "popular" || intent.priority === "classics" ? "bestsellers"
      : undefined;
  return {
    landingDepartment: first,
    departmentsFirst: [...intent.departments],
    quickAccess: rest,
    priceMode: intent.priority === "price" || intent.budget !== null,
    budget: intent.budget,
    sectionFirst: sectionFirst ?? (intent.budget ? "sale" : undefined),
    reason: `You said: "${intent.summary}"`,
  };
}

// ---------------------------------------------------------------- validation

/** Coerce anything (LLM output, request body) into a valid Intent, dropping unknown values. */
export function normalizeIntent(raw: unknown, source: Intent["source"]): Intent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const departments = (Array.isArray(r.departments) ? r.departments : [])
    .filter((d): d is IntentDepartment => (INTENT_DEPARTMENTS as readonly string[]).includes(String(d)))
    .filter((d, i, a) => a.indexOf(d) === i)
    .slice(0, 3);
  const priority = (INTENT_PRIORITIES as readonly string[]).includes(String(r.priority))
    ? (r.priority as IntentPriority)
    : "none";
  const summary = String(r.summary ?? "").trim().slice(0, 80);
  const budget = normalizeBudget(r.budget);
  if (!departments.length && priority === "none" && !budget) return null;
  return { departments, priority, budget, summary: summary || describe(departments, priority, budget), source };
}

function normalizeBudget(raw: unknown): IntentBudget | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const amount = Math.round(Number(b.amount));
  if (!Number.isFinite(amount) || amount < 1 || amount > 10000) return null;
  return { amount, scope: b.scope === "total" ? "total" : "per_item" };
}

// ---------------------------------------------------------------- keyword fallback (no API needed)

const DEPT_WORDS: Record<IntentDepartment, string[]> = {
  dept_baby_children: ["baby", "babies", "kid", "kids", "child", "children", "toddler", "newborn", "son",
    "daughter", "boy", "girl", "school", "nephew", "niece", "grandkid", "grandkids"],
  dept_menswear: ["men", "mens", "man", "male", "husband", "boyfriend", "dad", "father", "brother", "him",
    "his", "guy", "guys"],
  dept_ladieswear: ["women", "womens", "woman", "ladies", "lady", "wife", "girlfriend", "mom", "mother",
    "sister", "her", "female"],
  dept_divided: ["teen", "teens", "teenager", "teenage", "young", "college", "student", "streetwear", "trendy"],
  dept_sport: ["gym", "sport", "sports", "running", "run", "yoga", "workout", "training", "athletic",
    "activewear", "hiking", "fitness"],
};

const PRIORITY_WORDS: Record<Exclude<IntentPriority, "none">, string[]> = {
  price: ["cheap", "budget", "affordable", "deal", "deals", "sale", "discount", "discounted", "bargain",
    "inexpensive", "under", "save", "saving", "low price", "not expensive", "nothing expensive"],
  new: ["new", "latest", "trend", "trending", "fresh", "drop", "this season", "newest"],
  classics: ["basic", "basics", "classic", "classics", "essentials", "essential", "timeless", "simple", "staple"],
  popular: ["popular", "bestseller", "bestsellers", "best seller", "best-selling", "everyone"],
};

function hits(text: string, words: string[]): number {
  return words.reduce((n, w) => n + (new RegExp(`\\b${w.replace(/[-\s]/g, "[-\\s]?")}\\b`, "i").test(text) ? 1 : 0), 0);
}

const DEPT_PHRASE: Record<IntentDepartment, string> = {
  dept_ladieswear: "women's clothes", dept_menswear: "men's clothes", dept_divided: "teen and young styles",
  dept_sport: "sportswear", dept_baby_children: "kids' clothes",
};

function describe(departments: IntentDepartment[], priority: IntentPriority, budget: IntentBudget | null = null): string {
  const d = departments.map((x) => DEPT_PHRASE[x]).join(" and ");
  const out =
    priority === "price" ? (d ? `${d} on a budget` : "Budget picks")
      : priority === "new" ? (d ? `new ${d}` : "New arrivals")
      : priority === "classics" ? (d ? `basic ${d}` : "Basics")
      : priority === "popular" ? (d ? `bestselling ${d}` : "Bestsellers")
      : d;
  let text = out;
  if (budget) {
    const base = priority === "price" ? d : out;          // the number already says "budget"
    const cap = budget.scope === "total" ? `$${budget.amount} total budget` : `under $${budget.amount} each`;
    text = base ? `${base}, ${cap}` : budget.scope === "total" ? cap : `Anything ${cap}`;
  }
  return text.replace(/^./, (c) => c.toUpperCase());
}

/** True when the sentence gave the store nothing to act on. */
export function isEmptyIntent(intent: Intent): boolean {
  return !intent.departments.length && intent.priority === "none" && !intent.budget;
}

/** "$60", "60 dollars", "60 bucks", "60 usd" after a limit word ("under", "below", "budget", "spend", "max"...). */
export function parseBudget(text: string): IntentBudget | null {
  const t = text.toLowerCase().replace(/,/g, "");
  const num = String.raw`\$?\s*(\d{1,5}(?:\.\d{1,2})?)\s*(?:dollars?|bucks|usd|\$)?`;
  const total = new RegExp(String.raw`\b(?:budget(?: of| is)?|spend(?:ing)?(?: up to| at most| max(?:imum)?)?|total(?: of)?|up to|max(?:imum)?|no more than|at most|limit(?: of)?)\s*(?:of\s*)?` + num + String.raw`(\s*(?:total|in total|overall|altogether))?`);
  const perItem = new RegExp(String.raw`\b(?:under|below|less than|cheaper than|not more than|max)\s*` + num + String.raw`(\s*(?:each|per item|apiece|a piece|per piece))?`);
  const each = /\b(each|per item|apiece|a piece|per piece)\b/.test(t);
  let m = t.match(perItem);
  if (m) {
    const amount = Math.round(Number(m[1]));
    const scope = /\b(total|in total|overall|altogether|budget|spend)\b/.test(t) && !each ? "total" : "per_item";
    return amount >= 1 && amount <= 10000 ? { amount, scope } : null;
  }
  m = t.match(total);
  if (m) {
    const amount = Math.round(Number(m[1]));
    return amount >= 1 && amount <= 10000 ? { amount, scope: each ? "per_item" : "total" } : null;
  }
  m = t.match(/\$\s*(\d{1,5})/);         // a bare "$60" with no limit word: treat as a total budget
  if (m) {
    const amount = Number(m[1]);
    return amount >= 1 && amount <= 10000 ? { amount, scope: each ? "per_item" : "total" } : null;
  }
  return null;
}

export function keywordIntent(text: string): Intent {
  const t = text.toLowerCase();
  const departments = (Object.keys(DEPT_WORDS) as IntentDepartment[])
    .map((d) => [d, hits(t, DEPT_WORDS[d])] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d)
    .slice(0, 3);
  // "nothing expensive" / "not too expensive" count as price, so check them before the generic words
  const ranked = (Object.keys(PRIORITY_WORDS) as Exclude<IntentPriority, "none">[])
    .map((p) => [p, hits(t, PRIORITY_WORDS[p])] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const priority: IntentPriority = /\b(not|nothing|isn'?t)\s+(too\s+)?(expensive|pricey)\b/.test(t)
    ? "price"
    : ranked[0]?.[0] ?? "none";
  const budget = parseBudget(text);
  return { departments, priority, budget, summary: describe(departments, priority, budget), source: "keywords" };
}
