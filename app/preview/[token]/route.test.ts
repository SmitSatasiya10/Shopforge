import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const renderPublicStorefront = vi.fn();

vi.mock("@/lib/preview/public-storefront", () => ({
  renderPublicStorefront: (...args: unknown[]) => renderPublicStorefront(...args),
}));

const { GET } = await import("./route");

const params = Promise.resolve({ token: "abc123" });

function request() {
  return new NextRequest("http://localhost/preview/abc123");
}

describe("GET /preview/:token", () => {
  beforeEach(() => {
    renderPublicStorefront.mockReset();
  });

  it("renders the index page for an enabled token", async () => {
    renderPublicStorefront.mockResolvedValue({ html: "<!doctype html><html>home</html>" });

    const res = await GET(request(), { params });

    expect(renderPublicStorefront).toHaveBeenCalledWith("abc123", "index");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("<!doctype html><html>home</html>");
  });

  it("returns 404 without leaking detail when disabled/missing/broken", async () => {
    renderPublicStorefront.mockResolvedValue(null);

    const res = await GET(request(), { params });

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Error");
  });
});
