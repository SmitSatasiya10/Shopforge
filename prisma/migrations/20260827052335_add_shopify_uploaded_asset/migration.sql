-- CreateTable
CREATE TABLE "ShopifyUploadedAsset" (
    "id" TEXT NOT NULL,
    "shopifyStoreId" TEXT NOT NULL,
    "sourceUrlHash" TEXT NOT NULL,
    "shopifyReference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopifyUploadedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyUploadedAsset_shopifyStoreId_sourceUrlHash_key" ON "ShopifyUploadedAsset"("shopifyStoreId", "sourceUrlHash");

-- AddForeignKey
ALTER TABLE "ShopifyUploadedAsset" ADD CONSTRAINT "ShopifyUploadedAsset_shopifyStoreId_fkey" FOREIGN KEY ("shopifyStoreId") REFERENCES "ShopifyStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
