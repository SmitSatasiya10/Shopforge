import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signedSessionCookieHeader } from "@/lib/auth/test-helpers";

const OWNER_ID = "user-1";

const productFindUnique = vi.fn();
const productUpdate = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...args: unknown[]) => productFindUnique(...args),
      update: (...args: unknown[]) => productUpdate(...args),
    },
  },
}));

const buildImageCandidates = vi.fn();
vi.mock("@/lib/product/images/candidates", () => ({
  buildImageCandidates: (...args: unknown[]) => buildImageCandidates(...args),
}));

const { POST } = await import("./route");

const params = Promise.resolve({ id: "product-1" });

const CANDIDATES = {
  primary: [{ id: "original-0", url: "https://example.com/a.jpg", altText: null, source: "original" }],
  other: [],
};

const PERSONA_OPTIONS = [
  { id: "toddler-safety-parent", name: "Safety-first parent", description: "Wants a safe ride-on.", category: "family", icon: "🧸" },
  { id: "milestone-gift-giver", name: "Gift giver", description: "Buying for a birthday.", category: "gift", icon: "🎁" },
  { id: "active-outdoor-parent", name: "Outdoor parent", description: "Plays outside daily.", category: "outdoors", icon: "🥾" },
  { id: "value-conscious-shopper", name: "Value shopper", description: "Compares on price.", category: "general", icon: "🛍️" },
];

const ANGLE_OPTIONS = [
  { id: "safety-first", title: "Safety first", description: "Lead on safety.", icon: "🛡️" },
  { id: "birthday-gift", title: "Birthday gift", description: "Lead on gifting.", icon: "🎁" },
  { id: "outdoor-fun", title: "Outdoor fun", description: "Lead on play.", icon: "🌄" },
  { id: "great-value", title: "Great value", description: "Lead on price.", icon: "💡" },
];

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "product-1",
    title: "Kids Electric Ride-on Bike",
    description: "A ride-on bike.",
    price: 3299,
    compareAtPrice: null,
    currency: "INR",
    images: [{ url: "https://example.com/a.jpg", altText: null }],
    variants: [],
    options: [],
    vendor: "Storio",
    sourceUrl: "https://www.amazon.in/dp/B0F676VWJ9",
    sourcePlatform: "generic_html",
    importStatus: "succeeded",
    importError: null,
    importedFieldsMissing: [],
    importSource: "supplier",
    supplierPlatform: "amazon",
    generatedImagesJson: null,
    imageCandidatesJson: null,
    personaOptionsJson: { language: "en", options: PERSONA_OPTIONS },
    marketingAnglesJson: { language: "en", personaKey: "toddler-safety-parent", options: ANGLE_OPTIONS, recommendedId: "safety-first" },
    ...overrides,
  };
}

async function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/product/product-1/images", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await signedSessionCookieHeader(OWNER_ID) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  productFindUnique.mockReset();
  productUpdate.mockReset();
  buildImageCandidates.mockReset();
  productFindUnique.mockResolvedValue(productRow());
  productUpdate.mockResolvedValue({});
  buildImageCandidates.mockResolvedValue(CANDIDATES);
});

// The wizard reads personaStatus/angleStatus to decide whether the URL it was opened with
// still names options this product actually has — see the guard in app/import/page.tsx.
describe("POST /api/product/:id/images — persona/angle resolution status", () => {
  it("reports a persona id that isn't one of this product's options as stale", async () => {
    const res = await POST(await postRequest({ personaId: "special-occasion-gifter", angleId: "safety-first" }), { params });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.personaStatus).toBe("stale");
    expect(data.angleStatus).toBe("resolved");
  });

  it("reports a known persona id as resolved and passes it to candidate generation", async () => {
    const res = await POST(await postRequest({ personaId: "milestone-gift-giver" }), { params });
    expect((await res.json()).personaStatus).toBe("resolved");
    expect(buildImageCandidates.mock.calls[0][1].persona).toMatchObject({
      type: "generated",
      id: "milestone-gift-giver",
    });
  });

  it("reports \"none\" when the request names no persona or angle", async () => {
    const data = await (await POST(await postRequest({}), { params })).json();
    expect(data.personaStatus).toBe("none");
    expect(data.angleStatus).toBe("none");
  });

  it("treats a merchant's own persona text as resolved — it can never be stale", async () => {
    const data = await (await POST(await postRequest({ personaText: "parents of toddlers" }), { params })).json();
    expect(data.personaStatus).toBe("resolved");
  });

  it("reports an angle id that isn't one of this product's options as stale", async () => {
    const data = await (await POST(await postRequest({ personaId: "milestone-gift-giver", angleId: "gone-angle" }), { params })).json();
    expect(data.personaStatus).toBe("resolved");
    expect(data.angleStatus).toBe("stale");
  });

  it("treats every persona id as stale when the product has no cached options at all", async () => {
    productFindUnique.mockResolvedValue(productRow({ personaOptionsJson: null }));
    const data = await (await POST(await postRequest({ personaId: "milestone-gift-giver" }), { params })).json();
    expect(data.personaStatus).toBe("stale");
  });

  // The regression this guards: resolution must happen BEFORE the candidate cache short-circuit.
  // A revisit — back/forward, a restored tab — is exactly when a stale id turns up, and a
  // revisit is also exactly when the cached branch returns, so a status computed after it
  // would never be seen by the screen that needs it.
  it("still reports the statuses when candidates come from the cache", async () => {
    productFindUnique.mockResolvedValue(productRow({ imageCandidatesJson: CANDIDATES }));
    const data = await (await POST(await postRequest({ personaId: "special-occasion-gifter", angleId: "safety-first" }), { params })).json();
    expect(data.cached).toBe(true);
    expect(data.personaStatus).toBe("stale");
    expect(data.angleStatus).toBe("resolved");
    expect(buildImageCandidates).not.toHaveBeenCalled();
  });
});
