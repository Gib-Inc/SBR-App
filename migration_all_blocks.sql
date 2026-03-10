-- Block 1: Costing Foundation
-- Run once on Railway PostgreSQL

-- 1. Selling price on items (what SBR charges customers)
ALTER TABLE items ADD COLUMN IF NOT EXISTS selling_price REAL;

-- 2. Wastage / yield factor on BOM entries
--    0 = no waste (default), 5 = 5% extra material consumed per unit built
ALTER TABLE bill_of_materials ADD COLUMN IF NOT EXISTS wastage_percent REAL NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- Block 2: Production Run History
-- ─────────────────────────────────────────────────────────────────────────────

-- 3. Production runs — one row per batch build session
CREATE TABLE IF NOT EXISTS production_runs (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number  TEXT NOT NULL UNIQUE,           -- e.g. PR-2026-0001
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  created_by  TEXT,                           -- userId
  created_by_name TEXT,                       -- snapshot of email at build time
  notes       TEXT,
  total_products_built INTEGER NOT NULL DEFAULT 0,
  total_units_built    INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'COMPLETED'  -- COMPLETED | PARTIAL | FAILED
);

CREATE INDEX IF NOT EXISTS production_runs_created_at_idx ON production_runs(created_at);

-- 4. Production run lines — one row per product within a run
CREATE TABLE IF NOT EXISTS production_run_lines (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               VARCHAR NOT NULL REFERENCES production_runs(id),
  product_id           VARCHAR NOT NULL REFERENCES items(id),
  product_name         TEXT NOT NULL,
  product_sku          TEXT NOT NULL,
  quantity_built       INTEGER NOT NULL,
  components_consumed  JSONB,                 -- [{name, sku, qty}] snapshot
  build_cost_snapshot  REAL,                  -- total materials cost at build time
  success              BOOLEAN NOT NULL DEFAULT true,
  error_message        TEXT
);

CREATE INDEX IF NOT EXISTS production_run_lines_run_id_idx ON production_run_lines(run_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Block 3: Operations Cleanup
-- ─────────────────────────────────────────────────────────────────────────────

-- 5. Cycle count sessions
CREATE TABLE IF NOT EXISTS cycle_count_sessions (
  id                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_number    TEXT NOT NULL UNIQUE,          -- e.g. CC-2026-0001
  status            TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN | COMMITTED | CANCELLED
  notes             TEXT,
  created_by        TEXT,
  created_by_name   TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT now(),
  committed_at      TIMESTAMP,
  committed_by      TEXT,
  total_entries     INTEGER NOT NULL DEFAULT 0,
  total_variances   INTEGER NOT NULL DEFAULT 0
);

-- 6. Cycle count entries — one row per component per session
CREATE TABLE IF NOT EXISTS cycle_count_entries (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  VARCHAR NOT NULL REFERENCES cycle_count_sessions(id),
  item_id     VARCHAR NOT NULL REFERENCES items(id),
  item_name   TEXT NOT NULL,
  item_sku    TEXT NOT NULL,
  system_qty  INTEGER NOT NULL,  -- what the app showed when session was created
  counted_qty INTEGER,           -- NULL until Clarence enters it
  variance    INTEGER,           -- counted_qty - system_qty
  notes       TEXT
);

CREATE INDEX IF NOT EXISTS cycle_count_entries_session_id_idx ON cycle_count_entries(session_id);

-- No schema changes needed for:
-- Block 3c: Direct Orders  — uses existing sales_orders table with channel='DIRECT'
-- Block 3d: Amazon sync    — uses existing channels.sync_interval_hours column
-- Block 3e: User roles     — role column is TEXT already, 'warehouse' just works
