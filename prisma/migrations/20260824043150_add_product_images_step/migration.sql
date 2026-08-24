-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imageCandidatesJson" JSONB;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "selectedImagesJson" JSONB;
