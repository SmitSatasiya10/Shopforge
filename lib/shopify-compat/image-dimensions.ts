// Minimal, dependency-free image header parsing — just enough to correct the Image drop's
// `aspect_ratio` for real, locally-vendored theme images (the Base Theme's own /images/*).
// A wrong 1:1 guess is usually harmless, but this theme derives --header-height from a wide
// logo's width divided by aspect_ratio (snippets/transparent-header-css.liquid's negative
// margin trick) — a bad guess there inflates the header height enough to make the hero pull
// up over it and hide it entirely. No image library dependency: each format's dimensions live
// at a small, fixed byte offset in its header, so a few bytes of manual parsing is enough.

export interface ImageDimensions {
  width: number;
  height: number;
}

export function parseImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  return parsePng(bytes) ?? parseGif(bytes) ?? parseWebp(bytes) ?? parseJpeg(bytes);
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function parsePng(bytes: Uint8Array): ImageDimensions | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((b, i) => bytes[i] === b)) return null;
  const width = view(bytes).getUint32(16, false);
  const height = view(bytes).getUint32(20, false);
  return width && height ? { width, height } : null;
}

function parseGif(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null;
  const width = view(bytes).getUint16(6, true);
  const height = view(bytes).getUint16(8, true);
  return width && height ? { width, height } : null;
}

function parseWebp(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;
  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!isRiff || !isWebp) return null;
  const v = view(bytes);
  const fourCC = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (fourCC === "VP8 ") {
    const width = v.getUint16(26, true) & 0x3fff;
    const height = v.getUint16(28, true) & 0x3fff;
    return width && height ? { width, height } : null;
  }
  if (fourCC === "VP8L") {
    const [b0, b1, b2, b3] = [bytes[21], bytes[22], bytes[23], bytes[24]];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return width && height ? { width, height } : null;
  }
  if (fourCC === "VP8X") {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return width && height ? { width, height } : null;
  }
  return null;
}

/** SOF0-SOF15 markers (excluding DHT/JPG/DAC, which reuse the 0xC4/0xC8/0xCC range) carry the frame's height/width. */
function parseJpeg(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const v = view(bytes);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = v.getUint16(offset + 5, false);
      const width = v.getUint16(offset + 7, false);
      return width && height ? { width, height } : null;
    }
    const segmentLength = v.getUint16(offset + 2, false);
    offset += 2 + segmentLength;
  }
  return null;
}
