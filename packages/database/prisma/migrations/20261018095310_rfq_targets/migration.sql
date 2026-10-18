



-- AlterTable
ALTER TABLE "BuyingRequest" ADD COLUMN     "productId" UUID,
ADD COLUMN     "remoteListingId" UUID,
ADD COLUMN     "targetSupplierId" UUID;

-- AlterTable
ALTER TABLE "SupplierProfile" ADD COLUMN     "remoteNodeId" UUID;

-- CreateIndex
CREATE INDEX "BuyingRequest_targetSupplierId_idx" ON "BuyingRequest"("targetSupplierId");

-- AddForeignKey
ALTER TABLE "BuyingRequest" ADD CONSTRAINT "BuyingRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyingRequest" ADD CONSTRAINT "BuyingRequest_targetSupplierId_fkey" FOREIGN KEY ("targetSupplierId") REFERENCES "SupplierProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
