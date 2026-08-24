import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Encrypts Shopify access tokens at rest with AES-256-GCM, keyed off SHOPIFY_TOKEN_ENCRYPTION_KEY
// (see lib/shopify/config.ts). A pragmatic stand-in for the KMS envelope encryption the product
// spec (docs/product-spec/21-security-and-multi-tenancy.md §6) describes for production — this
// codebase has no KMS integration yet, so the token is encrypted with an application-level key
// rather than left in plaintext. Revisit with real KMS envelope encryption before real merchant
// tokens (beyond a dev/testing store) are stored.

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveKey(secret: string): Buffer {
  // sha256 lets SHOPIFY_TOKEN_ENCRYPTION_KEY be any length/format (e.g. `openssl rand -hex 32`)
  // while always yielding the 32-byte key aes-256-gcm requires.
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptToken(plaintext: string, encryptionKey: string): string {
  if (!encryptionKey) {
    throw new Error("SHOPIFY_TOKEN_ENCRYPTION_KEY is not set. Add it to .env to store Shopify tokens.");
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptToken(encoded: string, encryptionKey: string): string {
  if (!encryptionKey) {
    throw new Error("SHOPIFY_TOKEN_ENCRYPTION_KEY is not set. Add it to .env to read Shopify tokens.");
  }
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(encryptionKey), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
