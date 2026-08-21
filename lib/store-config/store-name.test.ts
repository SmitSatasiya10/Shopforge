import { describe, it, expect } from "vitest";
import { deriveStoreName, DEFAULT_STORE_NAME } from "./store-name";

// `shop.name` renders in the header logo, so anything long enough to be a product title is
// a bug — the Amazon import that motivated this put a 20-word listing title in the header.
describe("deriveStoreName", () => {
  it("uses the brand when the import found one", () => {
    expect(deriveStoreName({ vendor: "Gurubhai Equipments", title: "Round Catering Burner 10x10 Inch" })).toBe(
      "Gurubhai Equipments",
    );
  });

  it("never returns a whole product title", () => {
    const title =
      "Gurubhai Equipments Round Catering Burner 10x10 Inch Heavy Duty LPG Gas Stove Commercial Cooktop for Hotel Restaurant Kitchen";
    expect(deriveStoreName({ vendor: null, title })).toBe("Gurubhai Equipments");
  });

  it("stops at the first specification-looking word", () => {
    expect(deriveStoreName({ vendor: null, title: "Northwake 10x10 Inch Burner" })).toBe("Northwake");
  });

  it("falls back to the default when there is nothing usable", () => {
    expect(deriveStoreName({ vendor: null, title: null })).toBe(DEFAULT_STORE_NAME);
    expect(deriveStoreName({ vendor: "  ", title: "  " })).toBe(DEFAULT_STORE_NAME);
    expect(deriveStoreName(null)).toBe(DEFAULT_STORE_NAME);
    expect(deriveStoreName({ vendor: null, title: "10x10 Inch Burner" })).toBe(DEFAULT_STORE_NAME);
  });

  it("shortens a vendor that is itself a long string", () => {
    expect(deriveStoreName({ vendor: "Gurubhai Equipments Manufacturing Private Limited", title: null })).toBe(
      "Gurubhai Equipments",
    );
  });
});
