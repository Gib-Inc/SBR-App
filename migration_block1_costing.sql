-- Block 1: Costing Foundation
-- Run once on Railway PostgreSQL

-- 1. Selling price on items (what SBR charges customers)
ALTER TABLE items ADD COLUMN IF NOT EXISTS selling_price REAL;

-- 2. Wastage / yield factor on BOM entries
--    0 = no waste (default), 5 = 5% extra material consumed per unit built
ALTER TABLE bill_of_materials ADD COLUMN IF NOT EXISTS wastage_percent REAL NOT NULL DEFAULT 0;
