# Refit / ATELIER NINE

A fake fashion store that watches the first few clicks, infers a shopper type, and rewrites its own UI — hero, filters, sort, grid, checkout, and concierge — before the shopper pays.

This is not a chat that recommends three products. The page is the model output.

## Run

```bash
cd frontend
npm i
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) at **1280px or wider**. The store also works on its own at `/store`.

No `.env` keys are required. Visa and Sentry are local stubs.

## Demo

1. Pick **Price Hunter**. Seed defaults to **42**. Adaptive is on.
2. Press **Run**. A ghost cursor browses ATELIER NINE.
3. After a few events the engine classifies the session. The store switches to a sale-first layout: discount hero, sale filters, popups off, guest checkout.
4. The cursor adds a piece, opens mock Visa Unified Checkout, and lands on `/store/confirmation`.

Same persona and same seed replay the same choices (`mulberry32`).

## Personas

| Persona | What they do | Layout after classification |
| --- | --- | --- |
| Price Hunter | Sort cheap, filter sale, dismiss popups | Discount hero, sale filters, guest express |
| Trend Seeker | Sort newest, filter color, quick view | New-drop hero, quick view emphasis |
| Mission Shopper | Search, filter size, short path | Search emphasized, denser grid, hero minimized |
| Brand Loyalist | Bestsellers, Essentials, wishlist | Collection hero, loyalty pay |

Adaptive **off** keeps the default editorial layout even after a classification. Trait edits apply on the **next** run. Duplicate, export, and import personas as JSON.

## Surfaces

- `/` simulator chrome: persona editor, run controls, terminal, local observability, iframe of the store
- `/store` ATELIER NINE, including women, men, new in, sale, search, product, and confirmation

The terminal logs `[agent]`, `[tracker]`, `[engine]`, `[layout]`, `[sentry]`, and `[visa]`. The Observability tab shows replay crumbs, traces, and logs without a Sentry DSN.

`backend/` is reserved for the homepage and live-session models. The store does not wait on Python.
