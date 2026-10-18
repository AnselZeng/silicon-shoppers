# Store side of the Snowflake loop (for the UI team)

Copy these into `la-hacks-app` at the same paths:

| File | What it does |
| --- | --- |
| `lib/server/snowflake.ts` | server-only Snowflake client (key-pair sign-in), one shared connection |
| `app/api/events/route.ts` | `POST /api/events`: batch of store events → `EVENTS` |
| `app/api/layout/route.ts` | `GET /api/layout?userId=`: the shopper's `HomepageDoc` (or `null`) + trending |
| `lib/model/eventSink.ts` | browser: stable anonymous shopper id, batching, upload on tab hide |
| `lib/model/adapter.ts` | updated: stored session decisions, `store_products` ranking, preferred colors, collection filter |
| `lib/model/homepage.ts` | updated types: `store_products`, `session`, `preferences`, `evidence`, `user_id` |

## Setup

```
npm install snowflake-sdk
```

In `next.config.ts`: `const nextConfig: NextConfig = { serverExternalPackages: ["snowflake-sdk"] };`

`.env.local` (and the Vercel project's env vars); never prefix these with `NEXT_PUBLIC_`:

```
SNOWFLAKE_ACCOUNT=orgname-accountname
SNOWFLAKE_USER=ATELIER_APP
SNOWFLAKE_ROLE=ATELIER_APP_ROLE
SNOWFLAKE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----"
```

Prabhu creates the user and key with `python -m server app-user`. The key stays out of git. Without these variables both routes answer `disabled: true`, and the store runs on its defaults.

## Wiring (two small changes)

1. In `lib/sim/tracker.ts`, inside `emitStoreEvent`, after the `event` object is built:

   ```ts
   import { queueEvent } from "@/lib/model/eventSink";
   ...
   queueEvent(event);
   ```

2. Where the store picks its starting layout:

   ```ts
   import { getShopperId } from "@/lib/model/eventSink";
   import { modelLayout, rankCatalog } from "@/lib/model/adapter";

   const res = await fetch(`/api/layout?userId=${getShopperId()}`).then((r) => r.json());
   if (res.homepage) {
     const { layout, categoryOrder, highlightColors, log } = modelLayout(res.homepage, liveDecisions);
     const products = rankCatalog(CATALOG, res.homepage);
   } // else DEFAULT_LAYOUT
   ```

   Call it again whenever you want the latest from the laptop (on navigation, or every 60 s). The refresh runs every 2 minutes, so polling faster doesn't help.

## What to expect

- **New shoppers:** `homepage` is `null` until their first events reach the laptop's next refresh (up to about 2 minutes plus a 4 s upload batch). Show the defaults in the meantime.
- **First request after a quiet spell:** it takes 1 to 3 s while the Snowflake warehouse wakes up, then about 100 to 300 ms per request. Load the layout without blocking first paint.
- **`log` sources:** each entry is tagged "H&M model", "Live session" or "Your settings" (sorts and filters the shopper keeps choosing).
- **Returning shoppers:** start with last visit's session decisions, e.g. "You decide fast: one-tap add to bag (from your last visits)", until this visit's own decisions switch on.
