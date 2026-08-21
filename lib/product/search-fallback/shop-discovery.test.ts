import { describe, it, expect, vi } from "vitest";
import { discoverEtsyShops } from "./shop-discovery";

describe("discoverEtsyShops", () => {
  it("combines the model's JSON answer with etsy.com/shop/ URLs from citations, deduped and capped", async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      text: '["Libelt","DrinaBags"]',
      citations: [
        { url: "https://www.etsy.com/shop/Libelt?listing_id=1098533235", title: null }, // dup of answer
        { url: "https://www.etsy.com/shop/LeenasLittleLight", title: null },
        { url: "https://www.etsy.com/market/phone_strap", title: null }, // not a shop URL
        { url: "https://evil.example/shop/NotEtsy", title: null }, // off-platform
        { url: "https://www.etsy.com/shop/FifthShop", title: null },
        { url: "https://www.etsy.com/shop/SixthShop", title: null }, // beyond the cap
      ],
    });
    const shops = await discoverEtsyShops("handmade organza phone strap", chat);
    expect(shops).toEqual(["Libelt", "DrinaBags", "LeenasLittleLight", "FifthShop"]);
    expect(chat.mock.calls[0][0].userPrompt).toContain("handmade organza phone strap");
  });

  it("rejects shop names that aren't single alphanumeric tokens", async () => {
    const chat = vi.fn().mockResolvedValue({ ok: true, text: '["not a shop!","../etc","RealShop"]', citations: [] });
    expect(await discoverEtsyShops("mug", chat)).toEqual(["RealShop"]);
  });

  it.each([
    [{ ok: false, error: "no key" }],
    [{ ok: true, text: "no array here", citations: [] }],
  ])("resolves to an empty list on any failure, never throwing: %j", async (chatResult) => {
    const chat = vi.fn().mockResolvedValue(chatResult);
    expect(await discoverEtsyShops("mug", chat)).toEqual([]);
  });
});
