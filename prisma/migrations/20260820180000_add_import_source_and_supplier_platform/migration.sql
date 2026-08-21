-- AlterTable
ALTER TABLE "Product" ADD COLUMN "importSource" TEXT NOT NULL DEFAULT 'shopify';
ALTER TABLE "Product" ADD COLUMN "supplierPlatform" TEXT;
