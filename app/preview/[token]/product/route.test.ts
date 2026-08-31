import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const renderPublicStorefront = vi.fn();

vi.mock("@/lib/preview/public-storefront", () => ({
  renderPublicStorefront: (...args: unknown[]) => renderPublicStorefront(...args),
}));

const { GET } = await import("./route");

const params = Promise.resolve({ token: "abc123" });

function request() {
  return new NextRequest("http://localhost/preview/abc123/product");
}

describe("GET /preview/:token/product", () => {
  beforeEach(() => {
    renderPublicStorefront.mockReset();
  });

  it("renders the product page for an enabled token", async () => {
    renderPublicStorefront.mockResolvedValue({ html: "<!doctype html><html>product</html>" });

    const res = await GET(request(), { params });

    expect(renderPublicStorefront).toHaveBeenCalledWith("abc123", "product");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("<!doctype html><html>product</html>");
  });

  it("returns 404 when disabled/missing/broken", async () => {
    renderPublicStorefront.mockResolvedValue(null);

    const res = await GET(request(), { params });

    expect(res.status).toBe(404);
  });
});
