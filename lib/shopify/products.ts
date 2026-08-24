import { executeAdminGraphQL } from "@/lib/shopify/admin-client";
import { NormalizedProduct, NormalizedProductSchema } from "@/lib/product/types";

export interface ShopifyProductSummary {
  id: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  price: string | null;
  currency: string | null;
  productUrl: string;
}

interface ProductsQueryData {
  products: {
    nodes: {
      id: string;
      title: string;
      handle: string;
      featuredImage: { url: string } | null;
      priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
    }[];
  };
}

/** Lists a connected store's products for the import wizard's picker, via the Admin API
 * (read_products — no write_themes exemption needed, unlike publish). */
export async function listShopifyProducts(
  shopDomain: string,
  accessToken: string,
  limit = 24,
): Promise<ShopifyProductSummary[]> {
  const data = await executeAdminGraphQL<ProductsQueryData>(
    shopDomain,
    accessToken,
    `query listProducts($first: Int!) {
      products(first: $first) {
        nodes {
          id
          title
          handle
          featuredImage { url }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
        }
      }
    }`,
    { first: limit },
  );

  return data.products.nodes.map((p) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    imageUrl: p.featuredImage?.url ?? null,
    price: p.priceRangeV2?.minVariantPrice?.amount ?? null,
    currency: p.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
    productUrl: `https://${shopDomain}/products/${p.handle}`,
  }));
}

interface ProductDetailQueryData {
  product: {
    title: string;
    descriptionHtml: string | null;
    vendor: string | null;
    images: { nodes: { url: string; altText: string | null }[] };
    variants: { nodes: { title: string; price: string; compareAtPrice: string | null; sku: string | null }[] };
    options: { name: string; values: string[] }[];
  } | null;
}

/**
 * Fetches one product's full detail via the Admin API and normalizes it into the same
 * NormalizedProduct shape the scrape-based pipeline (lib/product/normalizer.ts) produces —
 * so it flows through the identical persist/status logic in app/api/product/import/route.ts.
 * Used when a merchant picks a product from a connected store's catalog (lib/shopify/products.ts
 * listShopifyProducts) instead of pasting a URL — notably, this works even when the store's
 * public storefront is password-protected, since it never touches the storefront at all.
 */
export async function fetchShopifyProductForImport(
  shopDomain: string,
  accessToken: string,
  productId: string,
  productUrl: string,
): Promise<NormalizedProduct | null> {
  const data = await executeAdminGraphQL<ProductDetailQueryData>(
    shopDomain,
    accessToken,
    `query productDetail($id: ID!) {
      product(id: $id) {
        title
        descriptionHtml
        vendor
        images(first: 10) { nodes { url altText } }
        variants(first: 50) { nodes { title price compareAtPrice sku } }
        options { name values }
      }
    }`,
    { id: productId },
  );

  const p = data.product;
  if (!p) return null;

  const variants = p.variants.nodes.map((v) => ({
    title: v.title,
    price: v.price ? Number(v.price) : null,
    sku: v.sku,
  }));

  return NormalizedProductSchema.parse({
    title: p.title,
    description: p.descriptionHtml ? p.descriptionHtml.replace(/<[^>]+>/g, "") : null,
    price: variants[0]?.price ?? null,
    compareAtPrice: p.variants.nodes[0]?.compareAtPrice ? Number(p.variants.nodes[0].compareAtPrice) : null,
    currency: null,
    images: p.images.nodes.map((img) => ({ url: img.url, altText: img.altText })),
    variants,
    options: p.options.map((o) => ({ name: o.name, values: o.values })),
    vendor: p.vendor || null,
    productUrl,
    source: "shopify",
  });
}
