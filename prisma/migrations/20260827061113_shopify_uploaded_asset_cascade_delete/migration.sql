-- DropForeignKey
ALTER TABLE "ShopifyUploadedAsset" DROP CONSTRAINT "ShopifyUploadedAsset_shopifyStoreId_fkey";

-- AddForeignKey
ALTER TABLE "ShopifyUploadedAsset" ADD CONSTRAINT "ShopifyUploadedAsset_shopifyStoreId_fkey" FOREIGN KEY ("shopifyStoreId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
