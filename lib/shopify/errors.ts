/** Split out from publish.ts so lib/shopify/asset-upload.ts can throw it without a circular import. */
export class PublishError extends Error {}
