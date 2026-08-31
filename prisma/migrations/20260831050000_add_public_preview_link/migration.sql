-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "publicPreviewEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicPreviewToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_publicPreviewToken_key" ON "Project"("publicPreviewToken");
