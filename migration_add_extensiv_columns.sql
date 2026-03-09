-- ============================================================================
-- Extensiv Integration: Database Migration
-- ============================================================================
-- Run this ONCE in Railway → PostgreSQL service → Query tab
-- Safe to run multiple times — all commands use IF NOT EXISTS
--
-- What it adds:
--   - extensiv_sku column (maps Railway items to Extensiv SKUs)
--   - extensiv_warehouse_id column (optional per-item warehouse override)
--   - extensiv_on_hand_snapshot column (last synced quantity from Extensiv)
--   - extensiv_last_sync_at column (timestamp of last sync)
--   - pivot_qty column (live Extensiv-sourced quantity for Pivot warehouse)
--   - Unique index on extensiv_sku (prevents duplicate mappings)
--   - inventory_adjustments table (for manual weekly counts)
-- ============================================================================

-- Extensiv SKU mapping (unique when not null)
ALTER TABLE items ADD COLUMN IF NOT EXISTS extensiv_sku TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS extensiv_warehouse_id TEXT;

-- Extensiv sync snapshot fields
ALTER TABLE items ADD COLUMN IF NOT EXISTS extensiv_on_hand_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS extensiv_last_sync_at TIMESTAMP;

-- Pivot warehouse quantity (authoritative mirror from Extensiv)
ALTER TABLE items ADD COLUMN IF NOT EXISTS pivot_qty INTEGER NOT NULL DEFAULT 0;

-- Unique index on extensiv_sku (only where not null — allows multiple nulls)
CREATE UNIQUE INDEX IF NOT EXISTS items_extensiv_sku_unique_idx
  ON items (extensiv_sku) WHERE extensiv_sku IS NOT NULL;

-- Inventory Adjustments table (manual counts by Sammie / Clarence)
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id VARCHAR NOT NULL REFERENCES items(id),
  sku TEXT NOT NULL,
  expected_qty INTEGER NOT NULL,
  actual_qty INTEGER NOT NULL,
  difference INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL DEFAULT 'WEEKLY_COUNT',
  location TEXT DEFAULT 'N/A',
  submitted_by TEXT NOT NULL,
  notes TEXT,
  applied BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration complete. Columns added (or already existed).';
  RAISE NOTICE 'Next step: Map your items to Extensiv SKUs in the extensiv_sku column.';
END $$;
