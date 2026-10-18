-- Full-text + trigram search support (trigram matching works for any script, including CJK).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_titleEn_trgm_idx" ON "Product" USING GIN ("titleEn" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_titleZh_trgm_idx" ON "Product" USING GIN ("titleZh" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "FederatedListing_title_trgm_idx" ON "FederatedListing" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "BuyingRequest_title_trgm_idx" ON "BuyingRequest" USING GIN ("title" gin_trgm_ops);

-- Inventory safety: never negative, never reserve more than on hand.
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_nonnegative_chk" CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_qty_chk" CHECK ("quantity" > 0);
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_chk" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_amounts_chk" CHECK ("unitPriceMinor" >= 0 AND "availableQty" >= 0);
