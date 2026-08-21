import { describe, it, expect, vi } from "vitest";
import {
  canonicalEtsyListingUrl,
  enrichEtsyProductsViaShopRss,
  enrichEtsySearchCandidates,
  parseEtsyListingId,
  parseEtsyListingTitleHint,
  parseEtsyShopRss,
} from "./etsy";
import type { NormalizedProduct } from "../types";

describe("parseEtsyListingId", () => {
  it.each([
    ["https://www.etsy.com/listing/1502712698", "1502712698"],
    ["https://www.etsy.com/listing/1502712698/handmade-ceramic-mug", "1502712698"],
    ["https://www.etsy.com/listing/1502712698/handmade-ceramic-mug?ref=shop_home_active_1", "1502712698"],
  ])("parses %s -> %s", (url, expected) => {
    expect(parseEtsyListingId(url)).toBe(expected);
  });

  it.each([["https://www.etsy.com/shop/SomeShop"], ["not a url"], ["https://www.etsy.com/"]])(
    "returns null for %s",
    (url) => {
      expect(parseEtsyListingId(url)).toBeNull();
    },
  );
});

describe("parseEtsyListingTitleHint", () => {
  it.each([
    ["https://www.etsy.com/listing/1502712698/handmade-ceramic-mug", "handmade ceramic mug"],
    [
      "https://www.etsy.com/in-en/listing/4529233980/cherry-blossom-tree-lamp-pink-floral?ls=r&ref=hp_content_grouping-2-2",
      "cherry blossom tree lamp pink floral",
    ],
  ])("derives a title hint from %s", (url, expected) => {
    expect(parseEtsyListingTitleHint(url)).toBe(expected);
  });

  it.each([["https://www.etsy.com/listing/1502712698"], ["https://www.etsy.com/shop/SomeShop"], ["not a url"]])(
    "returns null when there is no slug: %s",
    (url) => {
      expect(parseEtsyListingTitleHint(url)).toBeNull();
    },
  );
});

describe("canonicalEtsyListingUrl", () => {
  it("strips the locale prefix and every query parameter", () => {
    expect(
      canonicalEtsyListingUrl(
        "https://www.etsy.com/in-en/listing/4529233980/cherry-blossom-tree-lamp-pink-floral?ls=r&external=1&logging_key=abc%3Adef",
      ),
    ).toBe("https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral");
  });

  it("keeps a slug-less listing URL working", () => {
    expect(canonicalEtsyListingUrl("https://www.etsy.com/listing/1502712698?ref=x")).toBe(
      "https://www.etsy.com/listing/1502712698",
    );
  });

  it.each([["https://www.etsy.com/shop/SomeShop"], ["not a url"]])("returns null for %s", (url) => {
    expect(canonicalEtsyListingUrl(url)).toBeNull();
  });
});

// Mirrors the real feed structure: XML-escaped HTML description with image, price, description.
const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Etsy Shop for LampCraft</title>
  <item>
    <title>Cherry Blossom Tree Lamp, pink floral by LampCraft</title>
    <description>&lt;p class=&quot;image&quot;&gt;&lt;img src=&quot;https://i.etsystatic.com/1/r/il/aa/111/il_570xN.111_x.jpg&quot; border=&quot;0&quot; /&gt;&lt;/p&gt;&lt;p class=&quot;price&quot;&gt;64.27 USD&lt;/p&gt;&lt;p class=&quot;description&quot;&gt;A pink blossom lamp.&lt;br /&gt;Height: 40cm.&lt;/p&gt;</description>
    <link>https://www.etsy.com/in-en/listing/4529233980/cherry-blossom-tree-lamp-pink-floral?ref=rss</link>
  </item>
  <item>
    <title>Scandinavian Lampshade by LampCraft</title>
    <description>&lt;p class=&quot;image&quot;&gt;&lt;img src=&quot;https://i.etsystatic.com/1/r/il/bb/222/il_570xN.222_y.jpg&quot; border=&quot;0&quot; /&gt;&lt;/p&gt;&lt;p class=&quot;price&quot;&gt;40.00 EUR&lt;/p&gt;&lt;p class=&quot;description&quot;&gt;Fabric lampshade.&lt;/p&gt;</description>
    <link>https://www.etsy.com/in-en/listing/1111/scandinavian-lampshade?ref=rss</link>
  </item>
</channel>
</rss>`;

const baseProduct = (overrides: Partial<NormalizedProduct>): NormalizedProduct => ({
  title: null,
  description: null,
  price: null,
  compareAtPrice: null,
  currency: null,
  images: [],
  variants: [],
  options: [],
  vendor: null,
  productUrl: "https://www.etsy.com/shop/LampCraft",
  source: "search_related",
  ...overrides,
});

describe("parseEtsyShopRss", () => {
  it("parses items with image, price, currency, description, and canonical listing URL", () => {
    const listings = parseEtsyShopRss(RSS_XML);
    expect(listings).toHaveLength(2);
    expect(listings[0]).toEqual({
      listingId: "4529233980",
      title: "Cherry Blossom Tree Lamp, pink floral",
      imageUrl: "https://i.etsystatic.com/1/r/il/aa/111/il_570xN.111_x.jpg",
      price: 64.27,
      currency: "USD",
      description: "A pink blossom lamp.\nHeight: 40cm.",
      listingUrl: "https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral",
    });
  });
});

describe("enrichEtsyProductsViaShopRss", () => {
  it("fills image/price/description via title match and upgrades a shop URL to the listing URL", async () => {
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const [enriched] = await enrichEtsyProductsViaShopRss(
      [baseProduct({ title: "Cherry Blossom Tree Lamp", vendor: "LampCraft" })],
      fetchText,
    );
    expect(fetchText).toHaveBeenCalledWith("https://www.etsy.com/shop/LampCraft/rss");
    expect(enriched.images).toEqual([{ url: "https://i.etsystatic.com/1/r/il/aa/111/il_570xN.111_x.jpg", altText: "Cherry Blossom Tree Lamp" }]);
    expect(enriched.price).toBe(64.27);
    expect(enriched.currency).toBe("USD");
    expect(enriched.description).toContain("pink blossom lamp");
    expect(enriched.productUrl).toBe("https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral");
  });

  it("matches by listing ID when the product URL names one, never by title", async () => {
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const [byId, wrongId] = await enrichEtsyProductsViaShopRss(
      [
        baseProduct({ title: "Anything", vendor: "LampCraft", productUrl: "https://www.etsy.com/listing/1111/scandinavian-lampshade" }),
        // Listing 9999 isn't in the feed — a title match against another listing would attach the wrong image.
        baseProduct({ title: "Scandinavian Lampshade", vendor: "LampCraft", productUrl: "https://www.etsy.com/listing/9999/scandinavian-lampshade" }),
      ],
      fetchText,
    );
    expect(byId.images[0]?.url).toBe("https://i.etsystatic.com/1/r/il/bb/222/il_570xN.222_y.jpg");
    expect(wrongId.images).toEqual([]);
    expect(fetchText).toHaveBeenCalledTimes(1); // one feed fetch per shop, cached across the batch
  });

  it("keeps existing fields and passes products through unchanged when the feed is unreachable or no shop is known", async () => {
    const fetchText = vi.fn().mockResolvedValue(null);
    const withPrice = baseProduct({ title: "Cherry Blossom Tree Lamp", vendor: "LampCraft", price: 10, currency: "EUR" });
    const noShop = baseProduct({ title: "Cherry Blossom Tree Lamp", productUrl: "https://www.etsy.com/listing/42/x" });
    const [a, b] = await enrichEtsyProductsViaShopRss([withPrice, noShop], fetchText);
    expect(a).toEqual(withPrice);
    expect(b).toEqual(noShop);
    expect(fetchText).toHaveBeenCalledTimes(1); // only the product with a known shop triggers a fetch
  });

  it("does not fetch at all for products that are already complete", async () => {
    const fetchText = vi.fn();
    const complete = baseProduct({
      title: "Cherry Blossom Tree Lamp",
      vendor: "LampCraft",
      price: 10,
      currency: "USD",
      description: "done",
      images: [{ url: "https://i.etsystatic.com/x.jpg", altText: null }],
    });
    const [result] = await enrichEtsyProductsViaShopRss([complete], fetchText);
    expect(result).toEqual(complete);
    expect(fetchText).not.toHaveBeenCalled();
  });
});

describe("enrichEtsySearchCandidates", () => {
  // Reproduces the live-diagnosed failure: search candidates arrive with vendor:null, so the
  // shop RSS feed — the only bot-open source of Etsy listing images — was never consulted and
  // every related card showed "No image".
  const REQUESTED = { requestedTitle: "cherry blossom tree lamp pink floral", requestedListingId: "8888" };

  it("resolves missing shop names so RSS enrichment can fill images (the live 'No image' failure)", async () => {
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const resolveShops = vi.fn().mockResolvedValue({
      byUrl: new Map([["https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral", "LampCraft"]]),
      citedShops: [],
    });
    const products = await enrichEtsySearchCandidates({
      ...REQUESTED,
      mode: "exact",
      products: [
        baseProduct({
          title: "Cherry Blossom Tree Lamp",
          productUrl: "https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral",
        }),
      ],
      fetchText,
      resolveShops,
    });
    expect(resolveShops).toHaveBeenCalledWith([
      { url: "https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral", title: "Cherry Blossom Tree Lamp" },
    ]);
    expect(products).toHaveLength(1);
    expect(products[0].vendor).toBe("LampCraft");
    expect(products[0].images[0]?.url).toBe("https://i.etsystatic.com/1/r/il/aa/111/il_570xN.111_x.jpg");
    expect(products[0].price).toBe(64.27);
  });

  it("does not ask for shop names it already has or doesn't need", async () => {
    const fetchText = vi.fn().mockResolvedValue(null);
    const resolveShops = vi.fn().mockResolvedValue({ byUrl: new Map(), citedShops: [] });
    await enrichEtsySearchCandidates({
      ...REQUESTED,
      mode: "related",
      products: [
        baseProduct({ title: "Has Vendor", vendor: "LampCraft", productUrl: "https://www.etsy.com/listing/1/x" }),
        baseProduct({
          title: "Complete",
          productUrl: "https://www.etsy.com/listing/2/y",
          images: [{ url: "https://i.etsystatic.com/x.jpg", altText: null }],
          price: 5,
          description: "done",
        }),
      ],
      fetchText,
      resolveShops,
    });
    expect(resolveShops).not.toHaveBeenCalled();
  });

  it("canonicalizes locale-prefixed candidate URLs so RSS listing-ID matching works", async () => {
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const products = await enrichEtsySearchCandidates({
      ...REQUESTED,
      mode: "exact",
      products: [
        baseProduct({
          title: "Cherry Blossom Tree Lamp",
          vendor: "LampCraft",
          productUrl: "https://www.etsy.com/ca/listing/4529233980/cherry-blossom-tree-lamp-pink-floral?ref=x",
        }),
      ],
      fetchText,
    });
    expect(products[0].productUrl).toBe("https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral");
    expect(products[0].images).toHaveLength(1);
  });

  it("tops up related results with relevant, image-complete listings from the same shops", async () => {
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const candidate = baseProduct({
      title: "Pink Blossom Tree Lamp",
      vendor: "LampCraft",
      productUrl: "https://www.etsy.com/listing/9999/pink-blossom-tree-lamp", // not in the feed — stays imageless
    });
    const products = await enrichEtsySearchCandidates({ ...REQUESTED, mode: "related", products: [candidate], fetchText });

    // The feed's cherry-blossom lamp is added (image, price, description all from Etsy itself);
    // the feed's Scandinavian lampshade shares no product identity and never rides along.
    expect(products.map((p) => p.title)).toEqual(["Cherry Blossom Tree Lamp, pink floral", "Pink Blossom Tree Lamp"]);
    expect(products[0].images[0]?.url).toBe("https://i.etsystatic.com/1/r/il/aa/111/il_570xN.111_x.jpg");
    expect(products[0].vendor).toBe("LampCraft");
    expect(products[0].productUrl).toBe("https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral");
    expect(products[0].source).toBe("search_related");
    expect(fetchText).toHaveBeenCalledTimes(1); // one cached feed fetch shared by enrichment + top-up
  });

  it("never tops up in exact mode", async () => {
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const exact = await enrichEtsySearchCandidates({
      ...REQUESTED,
      mode: "exact",
      products: [baseProduct({ title: "Pink Blossom Tree Lamp", vendor: "LampCraft", productUrl: "https://www.etsy.com/listing/9999/x" })],
      fetchText,
    });
    expect(exact).toHaveLength(1);
  });

  it("recovers the exact requested listing from a candidate shop's feed in related mode", async () => {
    // The requested product turning up in a shop feed by ID is airtight — return IT (marked
    // search_exact so the import pipeline flips to a single-product result), not a related list.
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const recovered = await enrichEtsySearchCandidates({
      requestedTitle: "cherry blossom tree lamp pink floral",
      requestedListingId: "4529233980", // the feed's blossom lamp IS the requested product
      mode: "related",
      products: [baseProduct({ title: "Pink Blossom Tree Lamp", vendor: "LampCraft", productUrl: "https://www.etsy.com/listing/9999/x" })],
      fetchText,
    });
    expect(recovered).toHaveLength(1);
    expect(recovered[0].source).toBe("search_exact");
    expect(recovered[0].productUrl).toBe("https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral");
    expect(recovered[0].images[0]?.url).toBe("https://i.etsystatic.com/1/r/il/aa/111/il_570xN.111_x.jpg");
    expect(recovered[0].price).toBe(64.27);
    expect(recovered[0].vendor).toBe("LampCraft");
  });

  it("recovers an un-indexed listing via shop discovery when no candidate names its shop (live case)", async () => {
    // Live case: an organza phone strap too new for any search index — but its shop was
    // discoverable by product type, and the shop's feed contained the exact listing.
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const discoverShops = vi.fn().mockResolvedValue(["LampCraft"]);
    const recovered = await enrichEtsySearchCandidates({
      requestedTitle: "cherry blossom tree lamp pink floral",
      requestedListingId: "4529233980",
      mode: "related",
      products: [baseProduct({ title: "Some Other Blossom Lamp", productUrl: "https://www.etsy.com/listing/555/some-other-blossom-lamp" })],
      fetchText,
      discoverShops,
    });
    expect(discoverShops).toHaveBeenCalledWith("cherry blossom tree lamp pink floral");
    expect(recovered).toHaveLength(1);
    expect(recovered[0].source).toBe("search_exact");
    expect(recovered[0].images).toHaveLength(1);
  });

  it("fills an imageless exact match via shop discovery, keeping search-found fields", async () => {
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const discoverShops = vi.fn().mockResolvedValue(["LampCraft"]);
    const [product] = await enrichEtsySearchCandidates({
      requestedTitle: "cherry blossom tree lamp pink floral",
      requestedListingId: "4529233980",
      mode: "exact",
      products: [
        baseProduct({
          title: "Cherry Blossom Tree Lamp",
          currency: "ILS",
          price: 94.03,
          productUrl: "https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral",
        }),
      ],
      fetchText,
      discoverShops,
    });
    expect(product.images[0]?.url).toBe("https://i.etsystatic.com/1/r/il/aa/111/il_570xN.111_x.jpg");
    expect(product.price).toBe(64.27); // the feed's price is the listing's real price
    expect(product.vendor).toBe("LampCraft");
  });

  it("uses discovered shops for the related top-up when there is no exact hit", async () => {
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const discoverShops = vi.fn().mockResolvedValue(["LampCraft"]);
    const products = await enrichEtsySearchCandidates({
      ...REQUESTED, // requested listing 8888 — not in the feed
      mode: "related",
      products: [baseProduct({ title: "Pink Blossom Tree Lamp", productUrl: "https://www.etsy.com/listing/9999/x" })],
      fetchText,
      discoverShops,
    });
    expect(products.map((p) => p.title)).toEqual(["Cherry Blossom Tree Lamp, pink floral", "Pink Blossom Tree Lamp"]);
    expect(products[0].images).toHaveLength(1);
    expect(products[0].source).toBe("search_related");
  });

  it("uses shops cited by the vendor-resolution call for the top-up when no per-listing shop resolved (live case)", async () => {
    // Live case: every per-listing answer was null, but the call's search citations surfaced
    // an etsy.com/shop/ URL of a shop selling this kind of product — its feed carries
    // image-complete relevant items.
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const resolveShops = vi.fn().mockResolvedValue({ byUrl: new Map(), citedShops: ["LampCraft"] });
    const products = await enrichEtsySearchCandidates({
      ...REQUESTED, // requested listing 8888 — not in the feed
      mode: "related",
      products: [baseProduct({ title: "Pink Blossom Tree Lamp", productUrl: "https://www.etsy.com/listing/9999/x" })],
      fetchText,
      resolveShops,
    });
    expect(products.map((p) => p.title)).toEqual(["Cherry Blossom Tree Lamp, pink floral", "Pink Blossom Tree Lamp"]);
    expect(products[0].images).toHaveLength(1);
    expect(products[0].vendor).toBe("LampCraft");
  });

  it("skips shop discovery entirely for an exact match that already has an image", async () => {
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const discoverShops = vi.fn();
    await enrichEtsySearchCandidates({
      ...REQUESTED,
      mode: "exact",
      products: [
        baseProduct({
          title: "Cherry Blossom Tree Lamp",
          images: [{ url: "https://i.etsystatic.com/x.jpg", altText: null }],
          price: 10,
          description: "done",
          productUrl: "https://www.etsy.com/listing/8888/cherry-blossom",
        }),
      ],
      fetchText,
      discoverShops,
    });
    expect(discoverShops).not.toHaveBeenCalled();
  });

  it("adds nothing when there is no requested title to verify relevance against", async () => {
    const fetchText = vi.fn().mockResolvedValue(RSS_XML);
    const products = await enrichEtsySearchCandidates({
      requestedTitle: null,
      requestedListingId: null,
      mode: "related",
      products: [baseProduct({ title: "Pink Blossom Tree Lamp", vendor: "LampCraft", productUrl: "https://www.etsy.com/listing/9999/x" })],
      fetchText,
    });
    expect(products).toHaveLength(1);
  });
});
