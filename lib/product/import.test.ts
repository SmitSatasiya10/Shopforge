import { describe, it, expect } from "vitest";
import { importSupplierProduct, importCompetitorStore } from "./import";

// These cover the paths that resolve before any network call is made (invalid URL /
// unsupported platform detection), so they're fast and deterministic. Live-platform
// reachability (AliExpress/Amazon/Zendrop/Teemdrop/Etsy, and real competitor stores) was
// verified manually against the real sites — see the implementation summary — rather than
// asserted here, since automated tests shouldn't depend on a third party's uptime or bot
// defenses.
describe("importSupplierProduct", () => {
  it("rejects an invalid URL without detecting a platform", async () => {
    const { platform, result } = await importSupplierProduct("not a url");
    expect(platform).toBeNull();
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/not a valid URL/);
  });

  it("rejects an unsupported supplier host without fetching anything", async () => {
    const { platform, result } = await importSupplierProduct("https://example-supplier.com/product/1");
    expect(platform).toBeNull();
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/isn't supported yet/);
    expect(result.error).toContain("AliExpress");
  });
});

describe("importCompetitorStore", () => {
  it("rejects an invalid URL", async () => {
    const outcome = await importCompetitorStore("not a url");
    expect(outcome.error).toMatch(/not a valid URL/);
    expect(outcome.results).toEqual([]);
    expect(outcome.discovery).toEqual({ source: "none", discovered: 0, fetched: 0, succeeded: 0, failed: 0 });
  });
});
