import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const callOpenRouterChat = vi.fn();
beforeEach(() => {
  callOpenRouterChat.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});
// The chat call is mocked; resolveSearchModel keeps its real (env-driven) behavior so tests
// can exercise both the search-native default and the tool-driven mode via OPENROUTER_MODEL.
vi.mock("./openrouter-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./openrouter-client")>();
  return { ...actual, callOpenRouterChat: (...args: unknown[]) => callOpenRouterChat(...args) };
});

const { searchProductFallback } = await import("./index");

const INPUT = {
  sourcePlatform: "etsy" as const,
  sourceUrl: "https://www.etsy.com/listing/123/handmade-mug",
  listingId: "123",
  title: "Handmade Ceramic Mug",
  vendor: null,
};

describe("searchProductFallback", () => {
  it("returns an error without calling OpenRouter for an unsupported platform", async () => {
    const result = await searchProductFallback({ ...INPUT, sourcePlatform: "aliexpress" as never });
    expect(result.matchType).toBe("error");
    expect(callOpenRouterChat).not.toHaveBeenCalled();
  });

  it("scopes the search to the platform's domain and includes the source URL/listing ID/title in the prompt", async () => {
    callOpenRouterChat.mockResolvedValueOnce({ ok: true, text: '{"matchType":"none"}' });
    await searchProductFallback(INPUT);
    const [req] = callOpenRouterChat.mock.calls[0];
    expect(req.systemPrompt).toContain("etsy.com");
    expect(req.systemPrompt).toContain(INPUT.sourceUrl);
    expect(req.systemPrompt).toContain(INPUT.listingId);
    expect(req.systemPrompt).toContain(INPUT.title);
  });

  it("sends no tools to a search-native model (the default), which searches on its own", async () => {
    callOpenRouterChat.mockResolvedValueOnce({ ok: true, text: '{"matchType":"none"}' });
    await searchProductFallback(INPUT);
    const [req] = callOpenRouterChat.mock.calls[0];
    expect(req.tools).toEqual([]);
    expect(req.systemPrompt).toContain("web search");
  });

  it("drives the web_search/web_fetch tools when a tool-capable model is configured", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-4.1-mini");
    callOpenRouterChat.mockResolvedValueOnce({ ok: true, text: '{"matchType":"none"}' });
    await searchProductFallback(INPUT);
    const [req] = callOpenRouterChat.mock.calls[0];
    expect(req.tools[0]).toMatchObject({ type: "openrouter:web_search", filters: { allowed_domains: ["etsy.com"] } });
    expect(req.tools[1]).toMatchObject({ type: "openrouter:web_fetch" });
    expect(req.systemPrompt).toContain("web fetch tool");
  });

  it("maps an exact match to a NormalizedProduct, never fabricating unlisted fields", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "exact",
        exact: { title: "Handmade Ceramic Mug", price: 24.99, currency: "USD", url: INPUT.sourceUrl },
      }),
    });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("exact");
    if (result.matchType !== "exact") throw new Error("unreachable");
    expect(result.product.title).toBe("Handmade Ceramic Mug");
    expect(result.product.price).toBe(24.99);
    expect(result.product.description).toBeNull();
    expect(result.product.images).toEqual([]);
    expect(result.product.source).toBe("search_exact");
  });

  it("maps related candidates, capping and never fabricating missing fields", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "related",
        related: [
          { title: "Similar Mug A", url: "https://www.etsy.com/listing/1" },
          { title: "Similar Mug B", url: "https://www.etsy.com/listing/2", price: 19.99 },
        ],
      }),
    });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("related");
    if (result.matchType !== "related") throw new Error("unreachable");
    expect(result.products).toHaveLength(2);
    expect(result.products[0].source).toBe("search_related");
    expect(result.products[0].price).toBeNull();
    expect(result.products[1].price).toBe(19.99);
  });

  it("returns none when the model reports nothing found", async () => {
    callOpenRouterChat.mockResolvedValueOnce({ ok: true, text: '{"matchType":"none"}' });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("none");
  });

  it("salvages related candidates even when the model inconsistently labels the verdict 'none'", async () => {
    // Observed live: the model fills `related` but still sets matchType "none".
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "none",
        exact: null,
        related: [{ title: "Similar Mug", url: "https://www.etsy.com/listing/456/similar-mug" }],
      }),
    });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("related");
    if (result.matchType !== "related") throw new Error("unreachable");
    expect(result.products).toHaveLength(1);
  });

  it("drops related candidates that don't link to the platform's domain (allowed_domains isn't enforced upstream)", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "related",
        related: [
          { title: "NSN 4520-01-343-7525", url: "https://www.iso-group.com/NSN/4520-01-343-7525" },
          { title: "Similar Mug", url: "https://www.etsy.com/listing/456/similar-mug" },
          { title: "No URL at all" },
        ],
      }),
    });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("related");
    if (result.matchType !== "related") throw new Error("unreachable");
    expect(result.products).toHaveLength(1);
    expect(result.products[0].productUrl).toBe("https://www.etsy.com/listing/456/similar-mug");
  });

  it("returns none when every related candidate is off-domain", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "related",
        related: [{ title: "NSN part", url: "https://www.armyproperty.com/nsn/4520-01-362-9925" }],
      }),
    });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("none");
  });

  it("falls back to the source URL when an exact match carries an off-domain URL", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "exact",
        exact: { title: "Handmade Ceramic Mug", url: "https://evil.example/listing/123" },
      }),
    });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("exact");
    if (result.matchType !== "exact") throw new Error("unreachable");
    expect(result.product.productUrl).toBe(INPUT.sourceUrl);
  });

  it("retries once on malformed JSON, then returns an error, never throwing", async () => {
    callOpenRouterChat
      .mockResolvedValueOnce({ ok: true, text: "not json at all" })
      .mockResolvedValueOnce({ ok: true, text: "still not json" });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("error");
    expect(callOpenRouterChat).toHaveBeenCalledTimes(2);
  });

  it("recovers when the retry after a malformed response succeeds", async () => {
    callOpenRouterChat
      .mockResolvedValueOnce({ ok: true, text: "oops, prose" })
      .mockResolvedValueOnce({ ok: true, text: '{"matchType":"none"}' });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("none");
  });

  it("extracts a JSON object even if the model wraps it in extra prose", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: 'Here is the result:\n{"matchType":"none"}\nLet me know if you need more.',
    });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("none");
  });

  it("drops related candidates whose titles share no meaningful words with the requested product", async () => {
    // Observed live: wallets and shoulder bags returned as "related" for a bucket-bag request.
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "related",
        related: [
          { title: "Leather Wallet", url: "https://www.etsy.com/listing/900/leather-wallet" },
          { title: "Ceramic Mugs Set", url: "https://www.etsy.com/listing/901/ceramic-mugs-set" },
          { url: "https://www.etsy.com/listing/902/untitled" }, // no title — relevance unverifiable
        ],
      }),
    });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("related");
    if (result.matchType !== "related") throw new Error("unreachable");
    expect(result.products).toHaveLength(1);
    expect(result.products[0].title).toBe("Ceramic Mugs Set");
  });

  it("keeps a candidate image only when it's on the platform's own image CDN", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "related",
        related: [
          {
            title: "Similar Mug A",
            url: "https://www.etsy.com/listing/1",
            image: "https://i.etsystatic.com/12345/r/il/abc/il_680x540.jpg",
          },
          {
            title: "Similar Mug B",
            url: "https://www.etsy.com/listing/2",
            image: "https://random-cdn.example/some-unrelated.jpg",
          },
        ],
      }),
    });
    const result = await searchProductFallback(INPUT);
    if (result.matchType !== "related") throw new Error("expected related");
    expect(result.products[0].images).toEqual([
      { url: "https://i.etsystatic.com/12345/r/il/abc/il_680x540.jpg", altText: "Similar Mug A" },
    ]);
    expect(result.products[1].images).toEqual([]); // untrusted host — "No image" beats a wrong image
  });

  it("supports Amazon: scopes to the source marketplace's domain and mentions the ASIN", async () => {
    callOpenRouterChat.mockResolvedValueOnce({ ok: true, text: '{"matchType":"none"}' });
    await searchProductFallback({
      sourcePlatform: "amazon",
      sourceUrl: "https://www.amazon.in/dp/B0EXAMPLE1",
      listingId: "B0EXAMPLE1",
      title: "Cherry Blossom Tree Lamp",
      vendor: null,
    });
    const [req] = callOpenRouterChat.mock.calls[0];
    expect(req.systemPrompt).toContain("amazon.in");
    expect(req.systemPrompt).toContain("ASIN B0EXAMPLE1");
  });

  it("only accepts Amazon candidates that are real product pages (URL names an ASIN)", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "related",
        related: [
          { title: "Sakura Tree Lamp", url: "https://www.amazon.in/dp/B0AAAAAAA1" },
          { title: "Blossom Lamp (other marketplace)", url: "https://www.amazon.com/dp/B0BBBBBBB2" },
          { title: "Pink Tree Lamp search", url: "https://www.amazon.in/s?k=pink+tree+lamp" }, // search page
          { title: "Floral Lamp elsewhere", url: "https://evil.example/dp/B0CCCCCCC3" }, // off-platform
        ],
      }),
    });
    const result = await searchProductFallback({
      sourcePlatform: "amazon",
      sourceUrl: "https://www.amazon.in/dp/B0EXAMPLE1",
      listingId: "B0EXAMPLE1",
      title: "Cherry Blossom Tree Lamp",
      vendor: null,
    });
    if (result.matchType !== "related") throw new Error("expected related");
    expect(result.products.map((p) => p.productUrl)).toEqual([
      "https://www.amazon.in/dp/B0AAAAAAA1",
      "https://www.amazon.com/dp/B0BBBBBBB2",
    ]);
  });

  it("keeps Amazon candidate images on the m.media-amazon.com CDN", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "exact",
        exact: {
          title: "Cherry Blossom Tree Lamp",
          url: "https://www.amazon.in/dp/B0EXAMPLE1",
          image: "https://m.media-amazon.com/images/I/71abc123.jpg",
        },
      }),
    });
    const result = await searchProductFallback({
      sourcePlatform: "amazon",
      sourceUrl: "https://www.amazon.in/dp/B0EXAMPLE1",
      listingId: "B0EXAMPLE1",
      title: "Cherry Blossom Tree Lamp",
      vendor: null,
    });
    if (result.matchType !== "exact") throw new Error("expected exact");
    expect(result.product.images).toEqual([
      { url: "https://m.media-amazon.com/images/I/71abc123.jpg", altText: "Cherry Blossom Tree Lamp" },
    ]);
  });

  it("includes optional description/price context in the prompt when direct extraction produced it", async () => {
    callOpenRouterChat.mockResolvedValueOnce({ ok: true, text: '{"matchType":"none"}' });
    await searchProductFallback({
      ...INPUT,
      description: "A hand-thrown stoneware mug with a matte glaze.",
      price: 24.99,
      currency: "USD",
    });
    const [req] = callOpenRouterChat.mock.calls[0];
    expect(req.systemPrompt).toContain("hand-thrown stoneware mug");
    expect(req.systemPrompt).toContain("24.99 USD");
  });

  // ---------------------------------------------------------------------------
  // Regression tests for the live-diagnosed "No image" / bad-candidate failures
  // (see docs/etsy-supplier-import-audit.md): the model returning /market/ category
  // pages as "related listings", usable listings arriving only as url_citation
  // annotations, the exact listing appearing in citations without an "exact" verdict,
  // and prices reported with a currency symbol instead of an ISO code.

  const LAMP_INPUT = {
    sourcePlatform: "etsy" as const,
    sourceUrl: "https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral",
    listingId: "4529233980",
    title: "cherry blossom tree lamp pink floral",
    vendor: null,
  };

  it("rejects Etsy /market/ and /search category pages returned as related candidates (observed live)", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "related",
        related: [
          { title: "Cherry Blossom Bonsai Tree Lamp | Pink Flower LED Light", url: "https://www.etsy.com/market/cherry_lamp" },
          { title: "Cherry Blossom Tree Lamp, Pink Floral Bonsai Light", url: "https://www.etsy.com/fi-en/market/pink_floral_lamp" },
          { title: "Pink Blossom Lamp results", url: "https://www.etsy.com/search?q=pink+blossom+lamp" },
          { title: "LED Flower Tree Lamp: Pink Cherry Blossom Lighting", url: "https://www.etsy.com/listing/843542176/led-flower-tree-lamp-pink-cherry-blossom" },
        ],
      }),
    });
    const result = await searchProductFallback(LAMP_INPUT);
    if (result.matchType !== "related") throw new Error("expected related");
    expect(result.products).toHaveLength(1);
    expect(result.products[0].productUrl).toBe("https://www.etsy.com/listing/843542176/led-flower-tree-lamp-pink-cherry-blossom");
  });

  it("uses url_citation annotations as an additional candidate source, cleaning their titles", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: '{"matchType":"none"}',
      citations: [
        {
          url: "https://www.etsy.com/ca/listing/1866201926/cherry-blossom-lamp-sakura-led-night",
          title: "Cherry Blossom Lamp: Sakura LED Night Light - Etsy",
        },
        { url: "https://www.etsy.com/market/cherry_lamp", title: "Cherry Blossom Lamp - Etsy" }, // category page — dropped
        { url: "https://help.etsy.com/hc/en-us", title: "Etsy Help" }, // not a listing — dropped
      ],
    });
    const result = await searchProductFallback(LAMP_INPUT);
    if (result.matchType !== "related") throw new Error("expected related");
    expect(result.products).toHaveLength(1);
    expect(result.products[0].title).toBe("Cherry Blossom Lamp: Sakura LED Night Light");
    // Locale prefix stripped by canonicalization so downstream enrichment can dedupe/match by ID.
    expect(result.products[0].productUrl).toBe("https://www.etsy.com/listing/1866201926/cherry-blossom-lamp-sakura-led-night");
  });

  it("promotes a citation naming the requested listing ID to an exact match (observed live)", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "related",
        related: [{ title: "Some Other Blossom Lamp", url: "https://www.etsy.com/listing/99/blossom-tree-lamp" }],
      }),
      citations: [
        {
          url: "https://www.etsy.com/il-en/listing/4529233980/cherry-blossom-tree-lamp",
          title: "Cherry Blossom Tree Lamp, Pink Floral ... - Etsy",
        },
      ],
    });
    const result = await searchProductFallback(LAMP_INPUT);
    if (result.matchType !== "exact") throw new Error("expected exact");
    expect(result.product.source).toBe("search_exact");
    expect(result.product.title).toBe("Cherry Blossom Tree Lamp, Pink Floral");
    expect(result.product.productUrl).toBe("https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp");
  });

  it("maps a currency symbol to its ISO code and drops unknown currency junk (observed live: '₪')", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "exact",
        exact: { title: "Handmade Ceramic Mug", price: 503.25, currency: "₪", url: INPUT.sourceUrl },
      }),
    });
    const result = await searchProductFallback(INPUT);
    if (result.matchType !== "exact") throw new Error("expected exact");
    expect(result.product.currency).toBe("ILS");
  });

  it("runs one bounded second attempt with only the strongest terms when the first search finds nothing", async () => {
    const bagInput = {
      ...INPUT,
      sourceUrl: "https://www.etsy.com/listing/1612987502/beige-bucket-bag-medium-size-leather",
      listingId: "1612987502",
      title: "Beige Bucket Bag Medium Size Leather Bucket Bag Crossbody Bag",
    };
    callOpenRouterChat
      .mockResolvedValueOnce({ ok: true, text: '{"matchType":"none"}' })
      .mockResolvedValueOnce({
        ok: true,
        text: JSON.stringify({
          matchType: "related",
          related: [{ title: "Beige Leather Bucket Bag", url: "https://www.etsy.com/listing/77/beige-leather-bucket-bag" }],
        }),
      });

    const result = await searchProductFallback(bagInput);
    expect(callOpenRouterChat).toHaveBeenCalledTimes(2);
    expect(callOpenRouterChat.mock.calls[0][0].systemPrompt).toContain('"beige bucket bag medium size leather crossbody"');
    expect(callOpenRouterChat.mock.calls[1][0].systemPrompt).toContain('"beige bucket bag medium"');
    expect(result.matchType).toBe("related");
  });

  it("stops after the second attempt — never an uncontrolled search loop", async () => {
    const bagInput = {
      ...INPUT,
      title: "Beige Bucket Bag Medium Size Leather Bucket Bag Crossbody Bag",
    };
    callOpenRouterChat.mockResolvedValue({ ok: true, text: '{"matchType":"none"}' });
    const result = await searchProductFallback(bagInput);
    expect(callOpenRouterChat).toHaveBeenCalledTimes(2);
    expect(result.matchType).toBe("none");
  });

  it("demotes an 'exact' verdict naming a different listing ID to a related candidate (observed live)", async () => {
    // Requested listing 1612987599 doesn't exist; the model returned similar listing
    // 1612987502 labeled "exact". That must never be presented as the requested product.
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "exact",
        exact: {
          title: "Beige Bucket Bag, Medium Size Leather Bucket Bag",
          price: 137.29,
          currency: "EUR",
          url: "https://www.etsy.com/listing/1612987502/beige-bucket-bag-medium-size-leather",
        },
      }),
    });
    const result = await searchProductFallback({
      ...INPUT,
      sourceUrl: "https://www.etsy.com/listing/1612987599/beige-bucket-bag-medium-size-leather",
      listingId: "1612987599",
      title: "beige bucket bag medium size leather",
    });
    if (result.matchType !== "related") throw new Error("expected related, got " + result.matchType);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].source).toBe("search_related");
    expect(result.products[0].productUrl).toBe("https://www.etsy.com/listing/1612987502/beige-bucket-bag-medium-size-leather");
  });

  it("still accepts an exact verdict under a locale-variant URL of the requested listing", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "exact",
        exact: { title: "Handmade Ceramic Mug", url: "https://www.etsy.com/il-en/listing/123/handmade-mug" },
      }),
    });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("exact");
  });

  it("ranks related candidates by relevance score, closest match first", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        matchType: "related",
        related: [
          { title: "LED Tree Lamp", url: "https://www.etsy.com/listing/1/led-tree-lamp" },
          { title: "Pink Cherry Blossom Tree Lamp, Floral Light", url: "https://www.etsy.com/listing/2/pink-cherry-blossom-tree-lamp" },
        ],
      }),
    });
    const result = await searchProductFallback(LAMP_INPUT);
    if (result.matchType !== "related") throw new Error("expected related");
    expect(result.products.map((p) => p.title)).toEqual([
      "Pink Cherry Blossom Tree Lamp, Floral Light",
      "LED Tree Lamp",
    ]);
  });

  it("propagates the client's config error (missing API key) without retrying", async () => {
    callOpenRouterChat.mockResolvedValueOnce({ ok: false, error: "Web search isn't configured — set OPENROUTER_API_KEY." });
    const result = await searchProductFallback(INPUT);
    expect(result.matchType).toBe("error");
    expect(result.matchType === "error" && result.error).toMatch(/OPENROUTER_API_KEY/);
    expect(callOpenRouterChat).toHaveBeenCalledTimes(1);
  });
});
