-- Migration: set lead_time_days on supplier_items rows for FX Industries and
-- Pednar so the new lead-time tracking can compute expected-delivery dates.
--
-- Idempotent: only writes when the current value differs, so re-runs are
-- harmless. Safe to run multiple times.
--
-- Apply against Railway:
--   psql "$DATABASE_URL" -f migration_set_supplier_lead_times.sql
--
-- This is a one-off DATA migration; drizzle-kit push handles schema only.

BEGIN;

-- FX Industries → 21 day lead time on every supplier_items row
UPDATE supplier_items
SET lead_time_days = 21
WHERE supplier_id IN (
  SELECT id FROM suppliers WHERE LOWER(name) LIKE 'fx industries%'
)
AND (lead_time_days IS NULL OR lead_time_days <> 21);

-- Pednar → 14 day lead time on every supplier_items row
UPDATE supplier_items
SET lead_time_days = 14
WHERE supplier_id IN (
  SELECT id FROM suppliers WHERE LOWER(name) LIKE 'pednar%'
)
AND (lead_time_days IS NULL OR lead_time_days <> 14);

COMMIT;
