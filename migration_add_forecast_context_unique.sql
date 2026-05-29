-- Migration: add UNIQUE on product_forecast_context.product_id
--
-- WHY: shared/schema.ts declares `productId ... .unique()` and
-- storage.upsertProductForecastContext relies on `ON CONFLICT (product_id)`,
-- but the live database has no such unique constraint/index. So every
-- forecast-context refresh fails with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- and the product_forecast_context table (which holds sales velocity AND the
-- Google/Meta ad spend + ROAS columns) gets zero writes. drizzle-kit push
-- silently skipped adding the constraint, almost certainly because duplicate
-- product_id rows already exist.
--
-- WHAT THIS DOES: de-duplicates (keeps the most-recently-updated row per
-- product) then creates the unique index that ON CONFLICT (product_id) needs.
--
-- SAFE: product_forecast_context is a derived/denormalized cache that the
-- scheduler rebuilds every 6 hours once the upsert works again. Removing
-- duplicate cache rows loses no source-of-truth data, and nothing references
-- these rows (the FK points FROM this table TO items). Wrapped in a
-- transaction: if the unique index still cannot be created, the whole thing
-- rolls back and nothing changes.
--
-- ============================================================================
-- STEP 0 - PREVIEW (run this SELECT by itself FIRST; it changes nothing).
-- Shows how many duplicate rows would be removed, per product.
-- ============================================================================
--   SELECT product_id,
--          COUNT(*)      AS rows,
--          COUNT(*) - 1  AS rows_to_delete
--   FROM product_forecast_context
--   GROUP BY product_id
--   HAVING COUNT(*) > 1
--   ORDER BY rows DESC;
--
-- If that returns 0 rows, there are no duplicates and the DELETE below simply
-- affects nothing - only the index gets created. Either way the migration is safe.
-- ============================================================================

BEGIN;

-- 1) De-duplicate: keep the newest row per product_id (tiebreak by id),
--    delete the older duplicates. Deletes nothing if there are no duplicates.
DELETE FROM product_forecast_context
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY product_id
             ORDER BY last_updated_at DESC NULLS LAST, id DESC
           ) AS rn
    FROM product_forecast_context
  ) ranked
  WHERE ranked.rn > 1
);

-- 2) Add the unique CONSTRAINT that ON CONFLICT (product_id) requires. We use a
--    named constraint (not just an index) so it matches Drizzle's `.unique()`
--    and future `drizzle-kit push` sees it as already satisfied. Idempotent via
--    the existence guard. If duplicates somehow remain, this raises and the
--    whole transaction rolls back (nothing is left half-applied).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'product_forecast_context'::regclass
      AND contype  = 'u'
      AND conname  = 'product_forecast_context_product_id_unique'
  ) THEN
    ALTER TABLE product_forecast_context
      ADD CONSTRAINT product_forecast_context_product_id_unique UNIQUE (product_id);
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- STEP 3 - VERIFY (run after; both should confirm success):
--   -- the unique index should be listed:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'product_forecast_context'
--     AND indexdef ILIKE '%unique%';
--
--   -- row count should equal distinct product count (no dupes left):
--   SELECT COUNT(*) AS rows, COUNT(DISTINCT product_id) AS distinct_products
--   FROM product_forecast_context;
-- ============================================================================
