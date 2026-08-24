-- AlterTable
ALTER TABLE "ShopifyStore" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "refreshTokenCipher" TEXT;
