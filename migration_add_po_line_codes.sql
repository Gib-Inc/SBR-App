-- Migration: add per-line supplier item code + internal barcode to PO lines
--
-- WHY: schema.ts adds purchase_order_lines.supplier_item_code and
-- .internal_barcode, but `drizzle-kit push` is SKIPPED during the Railway build
-- (no DATABASE_URL at build time), so additive columns don't reach the live DB
-- automatically. Drizzle selects all defined columns, so deploying the new
-- schema WITHOUT these columns would break every PO line read. This adds them.
--
-- SAFE: additive, nullable, idempotent (ADD COLUMN IF NOT EXISTS). Nothing is
-- dropped or rewritten. Applied to production on 2026-06-03 via railway run
-- (user-authorized).
--
-- NOTE: this is the recurring schema-drift pattern. Any new column needs a
-- manual prod migration like this until migrations run at app startup (with a
-- live DATABASE_URL) instead of at build time.

ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS supplier_item_code text;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS internal_barcode text;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'purchase_order_lines'
--     AND column_name IN ('supplier_item_code', 'internal_barcode');
