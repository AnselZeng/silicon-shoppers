# Silicon Shoppers: goal and work plan

Last updated: 2026-10-17

## Goal

Demo a shopping site (ATELIER NINE) that rebuilds its layout for each user from their shopping profile. A judge builds a persona, presses Run, and watches the full pipeline: model, then LLM, then a store that re-arranges itself live. They can then browse the new store.

Example: a shopper who mostly buys menswear sees **Men** first in the nav, a menswear hero, menswear rows on the home page, and ads aimed at them.

## Thought process

1. **Persona:** the judge sets sliders (menswear vs. womenswear, sale buying, new arrivals, price level, colours). These generate a basket of 10–20 store products, which the judge can edit by hand.
2. **Model:** the basket goes to the H&M model (`origin/pb-backend`). It translates each item into H&M terms and returns a `HomepageDoc`: layout decisions with reasons and Tested/Assumed labels, a predicted mix, and ranked store products.
3. **Model layout:** code turns the model's output into a first layout (`modelLayout`, ported from the backend), with no LLM involved.
4. **LLM:** reads the model's output and the **design guideline** (allowed layout options, home block library, house ad catalog, rules, brand voice). It builds on the model layout and returns a config with a reason for each choice.
5. **Validation:** code copies product ids (the model's ranked products, the basket) into the config, then checks and fixes it. A broken LLM config falls back to the model layout.
6. **Store:** re-renders live, stepping from the default layout to the model layout to the LLM layout. A side panel shows each pipeline stage and the reasons. The judge then browses.

**Demo modes:**
- **Cached profiles:** a few prepared personas with precomputed model and LLM output, so they load instantly.
- **Live run:** one custom persona built on the spot, running the full pipeline, so judges see it working end to end.

## Where we are today

| Step | Status |
| --- | --- |
| Model | Exists on `origin/pb-backend`. Its current path (store events → Snowflake → refresh every 2 min) is too slow for a live run. We need a direct scoring endpoint. |
| Model output in the frontend | `lib/model/homepage.ts` and `adapter.ts` are stubs. Working versions (`HomepageDoc` type, H&M → store mapping, `rankCatalog`, `modelLayout`) exist in `backend/server/app/lib/model/` on `pb-backend`, written against today's flat layout config. |
| LLM | Not started. No SDK, route or prompt. |
| Layout options | 19 fields and 4 presets. No nav ordering, no ad system, a small set of home sections. |
| Store renders from config | Works: `setLayout` re-renders live. |
| Demo screen | Built around a robot cursor and a click classifier, both of which will be removed. |

## Key design decision

The LLM fills in a **fixed, validated layout schema**. It never generates pages or components, and never writes product ids. The model's validated decisions are kept. In the current build that means the model's section rows (New in, Sale, Bestsellers, Buy again) and category order stay in the model's order for every shopper. The LLM designs what the model doesn't cover: ads, the blocks around those rows, nav and copy. Every reason shown is the model's own reason or cites a number in its output.

## Work plan

### 0. Remove the robot cursor and click classifier

- Remove `lib/sim/agent.ts`, `evidence.ts`, `engine.ts`, the runner's agent loop, `GhostCursor`, `PERSONA_LAYOUTS`, and the trait editor fields the model doesn't use.
- Remove `data-agent-id` plumbing and agent-only protocol messages once nothing reads them.
- Keep the store events that feed the pipeline log.
- Done first, so the schema change in step 1 doesn't update code that's about to be deleted.

### 1. Layout options and design guideline

Expand the schema with navigation, house ads and home composition, and generate the design guideline from it. Details: [layout-expansion-plan.md](layout-expansion-plan.md).

### 2. Persona builder

Details: [persona-builder-plan.md](persona-builder-plan.md).

- Sliders: menswear/womenswear share, sale share, new-arrival share, price level, favourite colours, basket size.
- A deterministic generator turns slider values into a basket from the 84-product catalog (same values give the same basket).
- An editable basket: add or remove products by hand.
- Save, duplicate and export personas (reuse the current persona store where it fits).
- Replaces the current behaviour traits (popup tolerance, patience, etc.), which the model can't read.

### 3. Model integration

- **Backend (with the `pb-backend` owner):** a direct endpoint that takes a basket and returns a `HomepageDoc` in a few seconds, without Snowflake or the refresh loop.
- The model needs about 10 add-to-bags before it changes the landing department, so generated baskets should have at least 10 items.
- **Frontend:** port `HomepageDoc`, the H&M → store mapping, `rankCatalog` and `modelLayout` from the backend's `adapter.ts`, converted to the new schema (details in the layout plan). Add a client for the endpoint.
- **Departments:** follow the backend: Ladieswear and Divided → women, Menswear → men. Sport and Baby/Children are ignored.
- **Cached profiles:** model output saved as JSON for each demo persona.

### 4. LLM layout route

- `app/api/layout`: model output plus design guideline in, layout config out.
- Structured output / tool use with the JSON Schema generated from the zod schema.
- Code copies the ranked product ids and basket ids into the config, then the validator runs. If it fails, the model layout is used.
- Cache the result per persona. Cached profiles load from files.
- Pick the model and set a time budget for the live run, with a fallback if the call is slow.

### 5. Demo screen

- Replace the simulator with a pipeline view: persona, then model output, then LLM layout and reasons, then the live store.
- Animate the switch from default to model layout to LLM layout, so each stage's change is visible.
- After the run, the judge browses the store in the frame.
- Reuse the terminal and observability panels as the pipeline log where useful.

**Order:** 0 comes first. Then 1 and 3 can start at the same time; 3's backend endpoint is the longest lead item. 2 needs nothing from 1. 4 needs 1 and 3. 5 needs 2 and 4.

## Needed from the backend

1. A direct scoring endpoint: basket in, `HomepageDoc` out, a few seconds, runnable on the demo laptop.
2. Confirmation that `HomepageDoc` (in `backend/server/app/lib/model/homepage.ts`) is the stable output format, and which fields are always present.
3. `store_products` (ranked store products, currently up to 24, excluding basket items) included in the output for every request.
4. A sample `HomepageDoc` from the store scoring path (`build_docs` in `score.py`), including `store_products`, committed for frontend development. The H&M samples (`sample_homepages.json`) aren't committed, and their products are H&M articles rather than store products.

## Open questions

1. Which LLM, and what latency is acceptable for the live run?
2. How many cached demo personas, and which ones?
