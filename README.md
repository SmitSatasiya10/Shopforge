# Shopforge

Shopforge generates a working Shopify store from a product URL. AI selects and configures sections from a
first-party, owned Section Library, rendered through a LiquidJS preview that shares the exact same Liquid
templates that later run on Shopify, and edited visually before publishing to a real Shopify store.

No implementation code exists in this repository yet — it currently holds the product specification and the
research/planning record behind it.

## Start here

**[docs/product-spec/](docs/product-spec/README.md)** is the canonical, implementation-focused specification —
how Shopforge actually works. This is the source of truth for building the product. Read
[docs/product-spec/README.md](docs/product-spec/README.md) first; it indexes every other document in that
folder in the order you need them.

```
User -> Project/Store Creation -> Product URL -> Product Import/Scraper -> Normalized Product Data
     -> AI Generation -> Section Selection -> Section Ordering -> Section Settings/Content
     -> Store Configuration (JSON) -> LiquidJS Preview Renderer -> Same-Origin Preview iframe
     -> Visual Editor -> User Changes -> Store Configuration Updated -> LiquidJS Preview Updated
     -> Save/Version -> Publish -> Apply Configuration to Base Shopify Theme -> Shopify Theme
     -> Real Shopify Storefront
```

Core decisions (full list in [docs/product-spec/DECISIONS.md](docs/product-spec/DECISIONS.md)): we own the Base
Shopify Theme and the Section Library; the Store Configuration is the single source of truth; AI generates
structured configuration and content, never Liquid/HTML/CSS/JS; React/Next.js is the builder UI only, never the
storefront renderer; LiquidJS renders the preview using the same controlled Liquid templates that ship to
Shopify; Shopify is touched only at explicit Publish.

## Also in this repo

**[docs/research/](docs/research/README.md)** holds the research, competitive analysis, and architectural
decision history behind the specification above — useful for understanding *why* the product is built this
way, not *how* it works today. It is not maintained as a live spec and may describe rejected approaches; where
it conflicts with `docs/product-spec/`, the specification wins.

## Repository layout

```
docs/
├── product-spec/   Canonical implementation specification (start here)
└── research/       Research, competitive analysis, decision history
```
