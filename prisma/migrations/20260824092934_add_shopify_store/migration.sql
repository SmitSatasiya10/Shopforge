-- CreateTable
CREATE TABLE "ShopifyStore" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "accessTokenCipher" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyStore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyStore_shopDomain_key" ON "ShopifyStore"("shopDomain");
