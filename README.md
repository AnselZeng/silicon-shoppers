# Silicon Shoppers / SOCAL ATELIER

**SOCAL ATELIER** is a fashion store that watches who is shopping, from their purchase history, their first few clicks and a sentence about what they need, and **rewrites its own UI** before they pay: nav, hero, home rows, ads, sort, filters and cards. The layout comes from an H&M-trained model's output and an LLM that designs within a fixed schema.

> This is not a chatbot that recommends three products. **The page is the model output.**

Built at the LA Hacks AI Hackathon (UCLA, Oct 17 to 18, 2026) for the Visa challenge *"The Future of Shopping: Powered by AI, Secured by Visa"* and the Sentry track.

---

## Contents

- [The problem](#the-problem)
- [What we built](#what-we-built)
- [Demo in 2 minutes](#demo-in-2-minutes)
- [How it works](#how-it-works)
- [Results](#results)
- [Trust and responsibility](#trust-and-responsibility)
- [Challenges we ran into](#challenges-we-ran-into)
- [What we learned](#what-we-learned)
- [Run it](#run-it)
- [Repo map](#repo-map)
- [Tech stack](#tech-stack)
- [What's next](#whats-next)
- [Data and credits](#data-and-credits)

---

## The problem

Every online store shows every visitor the same layout: the same landing page, the same department order, the same rails, the same filters. But no two shoppers shop the same way.

- A parent buying baby clothes digs past three departments to reach Baby & Kids.
- A budget shopper scrolls past full-price items to find what they can afford.
- A first-time visitor gets a store tuned for an "average" customer who doesn't exist.

Today's personalization only swaps a few products in a recommendation strip; **the store itself never changes**. It can't tell who a new visitor is until they've bought something, and it rarely explains itself, so shoppers don't know why they see what they see and teams can't tell whether a change actually helped.

**Our question:** how can a store use AI to understand each shopper from their purchases, their live clicks and even a sentence about what they need, then rebuild its entire layout around them, change only when it's confident, and explain every decision?

---

## What we built

Three AI signals feed one store:

| Signal | What it learns | Model | When it acts |
| --- | --- | --- | --- |
| **Purchase history** | What you buy: departments, categories, colors, price level, sale and newness habits | Models trained on **100,000 real H&M shoppers** (GRU sequence model, LightGBM, learned blend, product ranker) | Before the first click |
| **Live clicks** | How you browse: pace, exploring vs deciding, comparing, cart habits | Session model trained on **200,000 real OTTO shoppers**, running in the browser | After every click |
| **What you say** | "Back-to-school stuff for my 6-year-old, under $25 each" | **Gemini** reads the model's output plus your sentence and designs the layout inside a fixed, validated schema | When you press Run |

What the store changes for you:

- **Department order and landing page:** Women first for most shoppers, but Baby & Kids moves up for a parent.
- **Quick-access tiles:** a shortcut for every department or category you buy far more than average (Baby & Kids, Men, Sport, Shoes...).
- **Homepage rails:** Sale first for a deal hunter, New in first for a trend seeker.
- **Budget mode:** "spend $100 total" shows a Budget picks rail, "Fits your budget" badges and a budget meter in the bag.
- **Browsing UI:** denser grid, one-tap quick add, compare panel and Recently Viewed switch on as the session model gets confident.
- **Checkout:** guest express for price hunters, loyalty pay for brand loyalists, through a mock Visa Unified Checkout.
- **Every change says why**, e.g. "Baby & Kids moved up to #2: 22% of your purchases, store average 4%".

---

## Demo in 2 minutes

1. **Normal store:** everyone sees the same editorial layout.
2. **Pick an AI shopper** (Price Hunter, seed 42, Adaptive on) and press **Run**. A ghost cursor browses SOCAL ATELIER while the terminal streams `[agent]`, `[tracker]`, `[engine]`, `[layout]`, `[sentry]` and `[visa]`.
3. After a few events the engine classifies the session and the store **switches live**: discount hero, sale filters, pop-ups off, guest checkout.
4. The cursor adds a piece, opens the **mock Visa Unified Checkout**, and lands on `/store/confirmation`.
5. **Tell the store what you need:** type "gym clothes for my husband, spend $100 total". Men and Sport move up, Budget picks appears, and every card shows whether it fits.
6. **Flip Adaptive off:** the same store snaps back to the default. Same persona and same seed replay the same choices.

---

## How it works

```
 Purchase history (H&M)          Live clicks (OTTO-trained)         A sentence (Gemini)
 100k shoppers, 2 years          first 3 to 40 events               "under $60, for my kid"
          |                                |                                  |
 GRU + LightGBM + blend          LightGBM trees in the browser      fixed JSON schema + keyword fallback
 + product ranker                predicts browsing style            departments, priority, budget
          |                                |                                  |
          +----------------+---------------+----------------------------------+
                           |
                 Confidence gates: change a decision only where it beat
                 the default on held-out data, or where the shopper asked
                           |
                 Layout + a reason for every change
                           |
          SOCAL ATELIER re-renders (and Sentry records why)
```

### 1. The purchase model (H&M)

- **Data:** 100,000 H&M shoppers (25,000 from each activity group, so light shoppers aren't buried), each summarized as a 25-number profile: category, department and color shares, price level, sale and newness affinity, rebuy share, online share, frequency and mainstreamness.
- **Labels:** what each shopper actually bought in the next 4 weeks.
- **Five model options, compared per decision:**
  - a learned blend of the shopper's history with store popularity (runs in the browser);
  - LightGBM, one model per decision;
  - a GRU over the last 30 purchases, trained across 11 earlier months so it learns seasons;
  - k-means personas, used as friendly labels;
  - a LightGBM product ranker on (shopper, product) pairs.
- **The best option per decision was picked on July data only**, and results are reported on August data.
- **A second pipeline** adds 128 purchase-history features and the H&M + OTTO fused profile, and exports one homepage document per shopper to Supabase.

### 2. The live session model (OTTO)

- H&M has purchases but no browsing data, and OTTO has browsing but different people, so we can't look anyone up in both.
- Instead, the session model learns browsing directly: for 200,000 OTTO shoppers it sees only their **first N events** (N = 3, 5, 10, 20, 40) and predicts how they browse for the rest of the session, so every number is a real forecast.
- It predicts 7 browsing-style values and maps them to UI decisions (grid density, quick add, compare panel, Recently Viewed, cart reminder, product-page density).
- **It only switches a decision on once its held-out accuracy is good enough** (R² of at least 0.10) for that many clicks.
- The trees run in the browser with no dependencies, and are verified identical to the Python model.

### 3. The conversational layer (Gemini)

- **Run** sends the model's output (layout decisions, predicted mix, evidence, with no product tiles or shopper ids) and the optional "Or describe them" sentence to a Next.js server route, `app/api/llm-layout`, which calls Gemini (`gemini-3.5-flash`, override with `GEMINI_MODEL`). The system prompt is the generated design guideline and the response is constrained to the layout JSON Schema (`LlmLayoutSchema`).
- **The LLM designs inside a box.** Code copies product ids in afterwards, and the validator enforces the model's validated decisions (section and category order), ad rules and copy limits, and drops any reason that cites a number not in the model's output. The sentence steers the design like an unvalidated decision and never overrides a validated one.
- **If Gemini fails** (no key, API error, invalid or unusable JSON), Run falls back to the model's rules (`modelLayout`) and the error goes to the terminal (`[llm]`), the browser console and the Observability tab.
- **Live every time:** temperature 0, and every Run streams a fresh answer (the side panel shows it as it's written). Set `LLM_CACHE=on` to reuse the answer for the same input instead. There is no timeout; Run waits for the LLM.
- **A keyword parser returns the same format** if there's no key, the API is slow, or the Wi-Fi drops, so the demo never breaks.
- **What leaves the app:** the model's aggregate output and the sentence, with no shopper ids. The API key stays on the server.

### 4. The store and the simulator

- **Next.js store:** SOCAL ATELIER (women, men, new in, sale, search, product, confirmation pages) runs in an iframe inside a simulator.
- **The simulator:** a persona editor (4 personas, about 21 traits each), seeded runs (mulberry32), a terminal and a local Observability tab.
- **The ghost-cursor agent** scores candidate actions with trait-weighted heuristics. The engine scores events, converts them with softmax, and declares a persona once its top probability is at least 0.75 after at least 3 events.
- **Layout changes** are sent into the store with a `set_layout` message.

---

## Results

All results are **offline replays**: each layout is scored against what real shoppers actually bought in the next 4 weeks (August 2020, held out), compared with the store's default layout. "Validated" means the 95% bootstrap confidence interval of the gain is above zero.

| What changes | Result |
| --- | --- |
| **Quick-access tiles** | Shoppers who get a Baby & Kids tile buy baby items next month **4.5x** as often as average (19.5% vs 4.3%); Shoes 4.3x, Men 2.5x, Sport 2.4x |
| **Homepage rails** | Ranking quality **0.843 to 0.876**, validated, better in every activity group |
| **Color highlight** | For shoppers who get it: **55.6%** of next purchases are in the highlighted colors vs 42.7% for the default colors |
| **Landing department** | For the shoppers it changes: **56%** of next purchases land there vs 29% under the default |
| **Department order** | Ranking quality 0.882 to 0.887, validated |
| **Category tabs** | A category they buy next is in the first 3 tabs for 90.7% of shoppers vs 88.7% |
| **Product ranking** | An item they buy next is in the top 10 for **62.2%** of shoppers vs 52.7% by popularity |
| **Live session model** | After 40 events it predicts browsing style better than 2 years of purchases do: click-to-cart R² **0.40** live vs 0.03 from purchase history; browsing pace 0.39 vs 0.07 |

---

## Trust and responsibility

- **Explains itself:** every block, tile, rail and badge carries a "Why am I seeing this?" reason.
- **Only changes when confident:** a decision only changes for a group of shoppers if it beat the default for that group on held-out data. Everyone else keeps the normal store.
- **The LLM is boxed in:** Gemini fills a fixed schema, the validator enforces the model's validated decisions, and it can't write product ids or touch prices.
- **You stay in control of money:** stated budgets drive the meter and badges. Checkout is a clearly labeled mock Visa Unified Checkout, and no real payment is taken.
- **Privacy:**
  - No age, location or customer IDs are used as model inputs.
  - The demo uses random shopper IDs.
  - Live learning stays in the browser.
  - Only the model's aggregate output and your typed sentence go to the LLM, never shopper ids.
- **Honest about limits:** offline replay is not an A/B test, so we make no causal claims. The profiles are not anonymous (99% are unique), so we keep the data private.

---

## Challenges we ran into

- **Two datasets, zero shared shoppers.** H&M has purchases and OTTO has browsing, but they're different people. We matched them by buying behavior, then measured the link: R² of 0.00 to 0.23, too weak to trust. So we stopped borrowing browsing from strangers and trained a live model on OTTO that learns from the visitor's own clicks. That turned into one of our best results.
- **Seasons broke our first model.** A model tuned in July carried summer demand (swimwear) into September and lost on category order. We fixed it two ways: training the GRU across 11 earlier monthly windows, and a seasonality offset that makes the trees learn only each shopper's deviation from the store's current mix.
- **The obvious idea was wrong.** We assumed budget shoppers want price low-to-high. On held-out data, the items they actually bought next ranked at 0.42 under that sort vs 0.87 under bestsellers: they buy cheap items, but popular ones. So we kept bestsellers and added the price filter first, a Budget picks rail and a budget meter instead.
- **"Women first" is usually right.** H&M's shoppers are mostly ladieswear buyers, so a top-1 landing page almost never changed. Even shoppers with mostly menswear history put 58% of their next purchases in Ladieswear (shared household accounts). We switched to a full department order plus quick-access tiles, which surface the parent's Baby & Kids or the husband's Men without forcing the landing page.
- **Strong baselines make gains look tiny.** Popularity order is already good, and most shoppers' layouts don't change, which dilutes the averages. We added confidence gates and report numbers for the shoppers whose layout actually changed.
- **Keeping the test honest.** Every choice was made on July data; August is only for reporting; a 2019 window stays untouched for one final clean test. We caught our own pseudo-window training overlapping that reserved window and added a hard check against it.
- **Running ML in a browser.** A simple linear copy of the product ranker kept only 35% of its top picks, so we exported the actual LightGBM trees to JSON with an exact TypeScript evaluator (matches LightGBM to about 1e-16).
- **Two vocabularies.** H&M has 5 departments and 18 colors, and our demo store has fewer, so an adapter maps between them and leaves unmapped values at their defaults.
- **Hackathon-grade infrastructure.** Laptops ran out of disk installing PyTorch, and background training jobs got killed, so we made training resumable with time budgets.
- **Putting an LLM in a store without letting it break the store.** We gave it a fixed schema, server-side keys, a validator between it and the store, and a fallback to the model's own rules.

---

## What we learned

- **The layout is a better place for AI than a recommendation strip.** Small structural changes (a tile, a reordered block) line up with what people buy next much more clearly than reshuffling products.
- **A few live clicks beat years of someone else's data** for predicting how a person browses.
- **"Don't change anything" is often the right model output.** Knowing when not to personalize is part of the product.
- **Test your intuitions on held-out data.** Price low-to-high for budget shoppers felt obvious and was wrong.

---

## Run it

```bash
cd frontend
npm i
npm run dev
```

- Open http://localhost:3000 at 1280px or wider. The store also works on its own at `/store`.
- No keys are required: Visa and Sentry are local stubs, and without a Gemini key Run builds the layout from the model's rules (the terminal says so).
- **Gemini:** add `GEMINI_API_KEY=...` to `frontend/.env.local` (free key from aistudio.google.com/apikey), then restart `npm run dev`. Optional `GEMINI_MODEL` overrides `gemini-3.5-flash`. Never put either in a `NEXT_PUBLIC_` variable.
- **Optional Sentry:** fill `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN` in `.env.local` to turn on Session Replay on `/store`, tracing and logs (custom spans: `simulation.run`, `agent.step`, `persona.infer`, `layout.adapt`).

**Rebuilding the models** (Python 3.12, needs the dataset via Git LFS; see the `h&m-model` and `model` branches): `python -m model.run_all` (H&M layout models), `python -m model all` (fused homepage model) and `python -m session_model all` (OTTO session model). Every branch README lists the inputs, outputs and expected numbers.

## Demo (layout preview)

1. The left panel lists **model output fixtures**: hand-written stand-ins for the H&M model's output (see `frontend/public/model/fixtures/README.md`).
2. Press **Model** to see the model's output: the JSON the LLM reads (decisions, reasons, predicted mix, ranked products). The store doesn't change; the model never changes the site on its own.
3. Press **LLM** to see a hand-written stand-in for the LLM's layout, run through the real pipeline (code copies in product ids, then the validator). Only this stage changes the store. **House default** goes back to the store everyone gets.
4. The panel shows each field's reason (the model's own reason and class label, or the LLM's) and how many validator fixes were needed. The terminal logs each step.
5. Browse the store in the frame: nav, hero, home rows, ads (top strip, hero, listing banner, grid tiles, popup, interstitial, sticky footer), sort, filters and cards all follow the layout.

With Snowflake configured, the store also loads that shopper's homepage document on first paint and lets the live session model adjust browsing fields as they click.

## How a layout is built

- `lib/layout/schema.ts`: the layout config (v2) as a zod schema. The LLM fills `LlmLayoutSchema`; it never writes product ids or URLs.
- `lib/model/`: the model's `HomepageDoc` type, the H&M → store mapping, the model policy the validator applies, the For You list, and `modelLayout()` for the live Snowflake path.
- `lib/layout/llm.ts`: the trimmed input the LLM reads, its prompt, and the layout schema converted for Gemini. `lib/server/gemini.ts` makes the call; `app/api/llm-layout` is the route Run uses.
- `lib/layout/pipeline.ts`: code copies the ranked products and basket into LLM output, then validates.
- `lib/layout/validate.ts`: one validator for every source, run inside the store's `setLayout`. It fixes small problems and reports them, and falls back to the house default when a config is broken.
- `lib/ads/catalog.ts`: the house ad catalog. `docs/design-guideline.md` is the LLM's guideline, generated by `npm run guideline`.

## Commands

From `frontend/`: `npm run dev`, `npm run lint`, `npm run build`, `npm test`, `npm run guideline` (regenerate the design guideline), `npm run fixtures` (regenerate the model fixtures).

---

## Repo map

| Where | What |
| --- | --- |
| `frontend/` | Next.js simulator and store: layout preview, terminal, Observability tab, SOCAL ATELIER |
| `frontend/lib/model/` | Model runtime in the browser: session model, layout adapter, Snowflake homepage fetch |
| `backend/` | Homepage and live-session models; the store falls back to defaults when Python is not configured |
| branch `dataset` | dataset-v1: 100k H&M shopper profiles, leak-free time windows, scoring harness |
| branch `dataset-fusion` | H&M + OTTO fused 37-value profiles, hosted on Supabase |
| branch `h&m-model` | H&M layout models, store structure (department order, tiles, price mode), browser engine, demo JSON |
| branch `model` | Fused homepage model, item ranker, Supabase export, OTTO live session model |
| branch `h&m-and-otto-model` | App plus model runtime (`lib/model/`) |

---

## Tech stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind, shadcn/ui, Zustand.
- **AI / ML:** PyTorch (GRU), LightGBM, scikit-learn, Gemini API, tree models exported to JSON and evaluated in TypeScript.
- **Data:** DuckDB, Parquet, Snowflake, Supabase (Postgres with row-level security), Git LFS.
- **Observability and payments:** `@sentry/nextjs` (with a local stub), mock Visa Unified Checkout.

---

## What's next

- Wire all three signals into one live layout per visitor in the demo, from purchase history to clicks to the sentence.
- A spending-rules checkout: the shopper approves limits ("max $60, kids only"), and an AI shopper fills the cart within them, through Visa's agentic-commerce APIs if we get sandbox access.
- Serve all 100,000 shoppers' layouts from Supabase behind sign-in.
- Run the one clean test on the reserved 2019 window, then a real A/B test.
- Per-person profiles for shared household accounts, the reason Ladieswear dominates even for menswear buyers.

Routes: `/` is the demo shell (layout preview, terminal, local observability, iframe of the store). `/store` is SOCAL ATELIER, including women, men, new in, sale, for you, search, product, and confirmation. The terminal logs `[tracker]`, `[model]`, `[layout]`, `[sentry]`, and `[visa]`. The Observability tab shows replay crumbs, traces, and logs without a Sentry DSN.

---

## Data and credits

- **H&M Personalized Fashion Recommendations** (Kaggle). Non-commercial academic use only; everyone with access accepted the competition rules. The data and derived files are never published, and the demo stays behind a password.
- **OTTO Recommender System Dataset** (Kaggle), CC BY 4.0. Credit: OTTO.
- SOCAL ATELIER is a fictional brand. Product names and images in the demo store are generated.
