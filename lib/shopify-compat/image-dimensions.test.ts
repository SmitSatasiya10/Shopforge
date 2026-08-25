import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseImageDimensions } from "./image-dimensions";

// A wrong 1:1 aspect_ratio guess for the Base Theme's own vendored images is what inflated
// --header-height enough to make the hero cover the header entirely (snippets/
// transparent-header-css.liquid derives it from a wide logo's width / aspect_ratio) — these
// parsers are what let resolve-settings.ts give the real theme's own images a real size.

describe("parseImageDimensions", () => {
  it("reads a real PNG from the vendored theme (the logo that exposed this bug)", async () => {
    const buf = await readFile(
      path.join(process.cwd(), "public/base-theme/images/primary-logo.png"),
    );
    expect(parseImageDimensions(new Uint8Array(buf))).toEqual({ width: 500, height: 104 });
  });

  it("parses a minimal PNG's IHDR width/height", () => {
    // 8-byte signature + a 25-byte IHDR chunk (length, "IHDR", 8-byte width/height, rest zeroed).
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 800, false);
    view.setUint32(20, 200, false);
    expect(parseImageDimensions(bytes)).toEqual({ width: 800, height: 200 });
  });

  it("parses a minimal GIF's logical screen width/height", () => {
    const bytes = new Uint8Array(10);
    bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
    const view = new DataView(bytes.buffer);
    view.setUint16(6, 640, true);
    view.setUint16(8, 480, true);
    expect(parseImageDimensions(bytes)).toEqual({ width: 640, height: 480 });
  });

  it("parses a JPEG's SOF0 frame width/height", () => {
    // SOI, then an APP0 segment to skip over, then SOF0 (0xC0) with height/width.
    const bytes = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0, length 4, 2 bytes payload
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03, 0x01, 0x00,
      // SOF0, length 11, precision 8, height 0x012c=300, width 0x0258=600
    ]);
    expect(parseImageDimensions(bytes)).toEqual({ width: 600, height: 300 });
  });

  it("returns null for bytes that match no known format", () => {
    expect(parseImageDimensions(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });
});
