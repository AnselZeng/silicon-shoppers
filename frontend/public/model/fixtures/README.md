# Model output fixtures (hand-written, not model output)

These files stand in for the H&M model's store scoring path (`build_docs` in
`backend/server/score.py` on `origin/pb-backend`) until the backend team commits a real
sample. Replace them when it arrives.

- `fixture-*.json`: one `HomepageDoc` each (`lib/model/homepage.ts`). `demo_id` and
  `user_id` start with `fixture-`, `run_id` is `fixture`, and `evidence.validated_on`
  says the file was not scored.
- `index.json`: the fixture list, with each persona's basket (store product ids). The
  basket isn't part of a `HomepageDoc`; in the real flow it comes from the persona builder.
- `*.llm.json`: hand-written stand-ins for LLM layout output (the LLM-written fields of
  `LlmLayoutSchema`; code copies product ids in before validation).

What is made up: the predicted mixes (category, department, section shares) and the
store's color and category priors. Everything derived from them follows `score.py`:
decision values, reason wording, `validated` flags (category_order and section_order
validated; landing_department not), `popups` always `off`, and `store_products` from
`rank_store` (top 24, basket items left out, no browsing or trending signal).

Regenerate the docs and index with `npx tsx scripts/make-fixtures.ts`. The `*.llm.json`
files are edited by hand.

| Fixture | Shopper |
| --- | --- |
| `fixture-men-sale` | Menswear, mostly bought on sale |
| `fixture-women-new` | Womenswear new arrivals, many dresses |
| `fixture-low-evidence` | 3 add-to-bags, close to the store average |
| `fixture-divided` | H&M Divided (young womenswear), maps to women |
