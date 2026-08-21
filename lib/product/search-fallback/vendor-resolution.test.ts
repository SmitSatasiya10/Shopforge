import { describe, it, expect, vi } from "vitest";
import { resolveEtsyShopNames } from "./vendor-resolution";

const LISTINGS = [
  { url: "https://www.etsy.com/listing/1866201926/cherry-blossom-lamp-sakura-led-night", title: "Cherry Blossom Lamp: Sakura LED Night Light" },
  { url: "https://www.etsy.com/listing/1226264679/floral-floor-lamp", title: null },
];

describe("resolveEtsyShopNames", () => {
  it("makes no call at all for an empty listing list", async () => {
    const chat = vi.fn();
    expect(await resolveEtsyShopNames([], chat)).toEqual({ byUrl: new Map(), citedShops: [] });
    expect(chat).not.toHaveBeenCalled();
  });

  it("includes each listing's title in the lookup so the model can search by product words", async () => {
    const chat = vi.fn().mockResolvedValue({ ok: true, text: "[]", citations: [] });
    await resolveEtsyShopNames(LISTINGS, chat);
    expect(chat.mock.calls[0][0].userPrompt).toBe(
      `${LISTINGS[0].url} — Cherry Blossom Lamp: Sakura LED Night Light\n${LISTINGS[1].url}`,
    );
  });

  it("maps answered shops back to the input URLs, matching by listing ID across locale variants", async () => {
    // Observed live: the model echoes /ca/listing/... variants of the URLs it was given.
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      text: JSON.stringify([
        { url: "https://www.etsy.com/ca/listing/1866201926/cherry-blossom-lamp-sakura-led-night", shop: "TheBuildPlate" },
        { url: LISTINGS[1].url, shop: null },
      ]),
      citations: [],
    });
    const { byUrl } = await resolveEtsyShopNames(LISTINGS, chat);
    expect(byUrl).toEqual(new Map([[LISTINGS[0].url, "TheBuildPlate"]]));
  });

  it("harvests etsy.com/shop/ URLs from the call's citations even when every answer is null (observed live)", async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      text: JSON.stringify([
        { url: LISTINGS[0].url, shop: null },
        { url: LISTINGS[1].url, shop: null },
      ]),
      citations: [
        { url: "https://www.etsy.com/shop/TatteredSisters", title: null },
        { url: "https://www.etsy.com/market/knot_pillow", title: null }, // not a shop
        { url: "https://www.etsy.com/shop/TatteredSisters?ref=x", title: null }, // dup
      ],
    });
    const { byUrl, citedShops } = await resolveEtsyShopNames(LISTINGS, chat);
    expect(byUrl.size).toBe(0);
    expect(citedShops).toEqual(["TatteredSisters"]);
  });

  it("rejects shop names that aren't single alphanumeric tokens (not safe to splice into a URL)", async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      text: JSON.stringify([{ url: LISTINGS[0].url, shop: "evil.example/../../x" }]),
      citations: [],
    });
    const { byUrl } = await resolveEtsyShopNames(LISTINGS, chat);
    expect(byUrl.size).toBe(0);
  });

  it("tolerates prose around the JSON array", async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      text: `Here you go:\n${JSON.stringify([{ url: LISTINGS[0].url, shop: "LeenasLittleLight" }])}\nDone.`,
      citations: [],
    });
    const { byUrl } = await resolveEtsyShopNames(LISTINGS, chat);
    expect(byUrl).toEqual(new Map([[LISTINGS[0].url, "LeenasLittleLight"]]));
  });

  it.each([
    [{ ok: false, error: "no key" }],
    [{ ok: true, text: "not json at all", citations: [] }],
  ])("resolves to an empty result on any failure, never throwing: %j", async (chatResult) => {
    const chat = vi.fn().mockResolvedValue(chatResult);
    const { byUrl, citedShops } = await resolveEtsyShopNames(LISTINGS, chat);
    expect(byUrl.size).toBe(0);
    expect(citedShops).toEqual([]);
  });
});
