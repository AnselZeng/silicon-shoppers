# Dynamic E-Commerce Personalization

The project is a dynamic e-commerce website that changes not only **what products a shopper sees, but how the website itself works** based on a compact representation of that shopper.

Traditional personalization systems primarily recommend or reorder products. This project extends personalization to the actual UX/UI. Depending on the shopper, the website can change category ordering, navigation priorities, default sorting, filter ordering, homepage sections, promotional banners, pop-ups, grid density, product-page structure, recently viewed sections, and other interface elements.

The core principle is:

> **Personalize how the store works, not just what the store recommends.**

## Shopper Vectors

Each shopper is represented by a compact **shopper vector** describing two broad things:

1. **Taste — what the shopper likes**
2. **Browsing style — how the shopper shops**

The goal is to construct approximately **100,000 shopper vectors** from real behavioral datasets and use those vectors to dynamically generate different versions of the same e-commerce storefront.

An important part of the project is keeping these profiles compact. Rather than depending on hundreds or thousands of personal attributes, we want to determine how much personalization can be preserved using a relatively small behavioral representation. The full vector can therefore be compared with compressed versions, such as 16, 8, or 4 dimensions, to see how much information is actually necessary.

The project uses two datasets because neither contains everything needed.

### H&M Dataset — What the Shopper Likes

The H&M Personalized Fashion Recommendations dataset contains customer purchase histories together with detailed product metadata.

It is used to derive features such as:

- category preferences
- department preferences
- color preferences
- preference for solid vs patterned clothing
- typical price level
- discount affinity
- preference for new products
- newsletter engagement
- online-shopping share

These features form the **taste and engagement portion** of the shopper vector.

For example, a shopper might strongly prefer menswear, frequently purchase shoes, prefer dark colors, rarely buy discounted products, and frequently purchase newly released items.

### OTTO Dataset — How the Shopper Shops

The OTTO Recommender Systems dataset contains large-scale e-commerce interaction histories consisting of:

- product clicks
- cart additions
- orders
- timestamps

OTTO does not provide meaningful product attributes such as category, color, price, or brand. Instead, it is useful for modeling **browsing behavior**.

Features derived from OTTO include:

- click-to-cart rate
- cart-to-order rate
- comparison behavior
- exploration breadth
- decision speed
- browsing pace
- multi-visit research behavior
- evening-shopping tendency
- weekend-shopping tendency

These describe whether someone behaves more like a careful comparer, fast decision-maker, broad explorer, cart abandoner, or another browsing style.

## Combining H&M and OTTO

The datasets contain completely different people, so shoppers cannot be directly matched across them.

Instead, the project uses a small set of **bridge features** that can be calculated independently in both datasets:

- purchase frequency
- basket size
- repeat-purchase behavior
- preference for popular/mainstream products
- activity spread across shopping days

These features are normalized within each dataset, for example using percentile ranks.

For each H&M shopper, the system finds OTTO shoppers with similar bridge behavior. The browsing characteristics of those nearby OTTO shoppers are then used to estimate the H&M shopper's browsing style.

Therefore, a final shopper profile contains:

- **Taste:** observed directly from H&M
- **Engagement:** observed directly from H&M
- **Bridge behavior:** observed directly from H&M
- **Browsing style:** estimated from behaviorally similar OTTO shoppers
- **Match confidence:** how closely the H&M shopper matched the selected OTTO shoppers

This distinction is important. The final vector is a **fused shopper profile**, not a claim that the same individual appears in both datasets. The H&M portion represents observed behavior from that customer, while the OTTO portion is an estimate of how someone with similar purchasing behavior may browse.

## Example Shopper Vector

A simplified shopper could look conceptually like this:

```text
Taste
  shoes affinity             0.31
  tops affinity              0.28
  accessories affinity       0.14
  menswear affinity          0.62
  dark-color preference      0.71
  solid preference           0.84
  price level                0.35
  discount affinity          0.22
  novelty preference         0.58

Engagement
  newsletter engagement      0.00
  online-shopping share      0.90

Browsing Style
  click-to-cart              0.12
  cart-to-order              0.81
  comparison                 0.47
  exploration                0.40
  decision speed             0.25
  browsing pace              0.30
  multi-visit research       0.77
  evening shopping           0.64
  weekend shopping           0.21

Bridge
  purchase frequency         0.55
  basket size                0.62
  repeat buying              0.18
  mainstream preference      0.66
  activity spread            0.40
```

This represents someone who mainly shops menswear, strongly prefers dark and solid clothing, has a particular interest in shoes, likes relatively new products, shops mostly online, compares products carefully, takes time before deciding, frequently returns across multiple visits, but usually completes a purchase once something reaches their cart.

## Turning the Vector Into a Website

The shopper vector is passed into a **layout engine**.

Conceptually:

```text
shopper vector
      ↓
layout engine
      ↓
personalized layout configuration
      ↓
dynamic storefront
```

The layout engine converts shopper characteristics into explicit interface decisions.

For example:

- High shoe affinity → Shoes appears earlier in navigation and homepage sections.
- High novelty preference → New Arrivals appears near the top and "Newest" may become the default sort.
- High discount affinity → Sale becomes prominent and price-related filters move upward.
- Strong color preference → Color filters become more prominent and preferred colors can be emphasized.
- High comparison behavior → Comparison tools, reviews, and product details become more prominent.
- Fast, decisive shopper → Cleaner product pages with prominent purchase actions and fewer distractions.
- Broad explorer → Denser product grids exposing more products at once.
- Multi-visit researcher → Recently Viewed becomes prominent.
- Low marketing engagement → Promotional pop-ups are suppressed.
- High cart abandonment → Saved-cart or reminder UI can become more prominent.

Two shoppers interested in the same products can therefore receive different interfaces.

For example, two shoppers may both strongly prefer shoes. A careful comparer could see shoes first together with detailed reviews and comparison tools. A fast, exploratory shopper could also see shoes first, but in a larger visual grid with fewer details and faster access to many products.

## Product Ranking

Products should be represented using features compatible with the taste portion of the shopper vector, including attributes such as:

- category
- department
- color
- pattern
- price level
- discount status
- newness
- popularity

The system can then rank products according to how closely their features match the shopper's preferences.

This means the same shopper vector controls both:

**what appears** — product and category ranking

and

**how it appears** — the UX/UI used to present those products.

## Web Application

The demo is a fictional fashion e-commerce store.

The application should allow a user to select one of the precomputed shoppers and immediately see the storefront adapt to that shopper's vector.

The interface should contain:

- a shopper selector
- a visualization of the selected shopper vector
- the dynamic fashion storefront
- a Static/Dynamic toggle for directly comparing the default site with the personalized version
- an explanation or terminal showing why each layout decision was made

For example:

```text
[vector] Loaded shopper 01842

[layout] Department → Menswear
Reason: menswear affinity = 0.62

[layout] Primary category → Shoes
Reason: shoe affinity = 0.31

[layout] Default sort → Newest
Reason: novelty preference = 0.58

[layout] Pop-ups → Disabled
Reason: newsletter engagement = 0.00

[layout] Product page → Comparison-focused
Reason: comparison behavior = 0.47
```

The personalization should therefore be transparent rather than appearing as an unexplained black box.

## System Architecture

The system has two major components.

### Offline Data Pipeline

Python processes the H&M and OTTO datasets and produces the shopper profiles.

```text
H&M data ──────→ Taste + Engagement ──┐
                                      │
                Bridge Matching ──────┼─→ Fused Shopper Vectors
                                      │
OTTO data ─────→ Browsing Behavior ───┘
```

The pipeline produces approximately 100,000 shopper vectors. A smaller subset can be exported for the interactive website.

### Web Application

The frontend loads a shopper vector and passes it through the layout engine.

```text
Shopper Vector
      ↓
Layout Engine
      ├── Product Ranking
      ├── Navigation
      ├── Homepage Sections
      ├── Filters
      ├── Sorting
      ├── Promotions
      ├── Grid Style
      └── Product Page UX
      ↓
Dynamic Storefront
```

The demo can be implemented in Next.js/TypeScript and deployed through Vercel. The data-processing pipeline can be implemented separately in Python.

## Evaluation

The project should demonstrate that the dynamic storefront does more than simply look different.

The personalized version should be compared against a **static storefront** that gives every shopper the same layout and product ordering. Held-out shopper behavior can then be used to determine whether personalization does a better job of surfacing products or categories that the shopper later purchases.

The same evaluation can also be repeated as the shopper vector is compressed from the full representation to smaller versions. This shows how much personalization quality is retained as the amount of shopper information is reduced.

The objective is therefore not simply maximum personalization, but **useful personalization from a compact behavioral profile**.

## Sentry Integration

Sentry is used as the observability layer for the dynamic personalization system.

Relevant integrations include:

- **Tracing** for measuring layout generation and product-ranking performance
- **Session Replay** for observing sessions where the interface dynamically changes
- **Logs** for recording shopper-vector loading and layout decisions
- tags or metadata describing the shopper type and personalization configuration

This makes it possible to inspect both the technical performance of personalization and the exact interface changes produced during a session.

## Core Demo

The strongest demonstration is a direct comparison between shoppers.

Select Shopper A and show the default storefront transform according to their preferences. Then select Shopper B and show the same underlying store reorganize itself differently.

The important point is that the system is not simply recommending different products.

**The website itself becomes different for different shoppers.**

The complete project is therefore:

> **A data-driven personalization system that builds compact shopper profiles from real purchase and browsing behavior and uses those profiles to dynamically adapt both product ranking and the UX/UI of an e-commerce storefront.**