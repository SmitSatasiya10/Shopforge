-- CreateTable: Store (no activeThemeId FK yet — Project.storeId doesn't exist until step 2/backfill)
CREATE TABLE "Store" (
    "id"             TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "productId"      TEXT NOT NULL,
    "shopifyStoreId" TEXT,
    "activeThemeId"  TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Store_productId_key" ON "Store"("productId");
CREATE UNIQUE INDEX "Store_activeThemeId_key" ON "Store"("activeThemeId");

ALTER TABLE "Store" ADD CONSTRAINT "Store_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Store" ADD CONSTRAINT "Store_shopifyStoreId_fkey" FOREIGN KEY ("shopifyStoreId") REFERENCES "ShopifyStore"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: add Project.storeId nullable for now, backfilled below before it's locked NOT NULL
ALTER TABLE "Project" ADD COLUMN "storeId" TEXT;

-- Backfill: one Store per existing Project (today's relationship is 1:1 via productId),
-- copying its name/productId/shopifyStoreId/timestamps.
INSERT INTO "Store" ("id", "name", "productId", "shopifyStoreId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "name", "productId", "shopifyStoreId", "createdAt", "updatedAt"
FROM "Project";

-- Point each existing Project at its new Store.
UPDATE "Project" p
SET "storeId" = s."id"
FROM "Store" s
WHERE s."productId" = p."productId";

-- Every existing Project is implicitly "the" theme for its store.
UPDATE "Store" s
SET "activeThemeId" = p."id"
FROM "Project" p
WHERE p."storeId" = s."id";

-- Lock storeId down now that every row has one, and add the Project -> Store FK.
ALTER TABLE "Project" ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "Project" ADD CONSTRAINT "Project_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Now that Project.storeId (and rows) exist, add the Store -> Project active-theme FK.
ALTER TABLE "Store" ADD CONSTRAINT "Store_activeThemeId_fkey" FOREIGN KEY ("activeThemeId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contract: drop the columns that moved from Project to Store.
ALTER TABLE "Project" DROP CONSTRAINT "Project_productId_fkey";
ALTER TABLE "Project" DROP CONSTRAINT "Project_shopifyStoreId_fkey";
DROP INDEX "Project_productId_key";
ALTER TABLE "Project" DROP COLUMN "productId";
ALTER TABLE "Project" DROP COLUMN "shopifyStoreId";

-- AlterTable: PublishRecord.project should cascade-delete now that themes (Projects) can be
-- deleted individually — previously RESTRICT was invisible since no theme-delete path existed.
ALTER TABLE "PublishRecord" DROP CONSTRAINT "PublishRecord_projectId_fkey";
ALTER TABLE "PublishRecord" ADD CONSTRAINT "PublishRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
