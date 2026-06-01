-- Migration: Swap old packaging boxes for new ones in Push 1.0 and Push 2.0 BOMs.
--
-- Push 1.0: SBR-PKG-BOXP10 → SBR-PKG-BOXP10-NEW
-- Push 2.0: SBR-PKG-BOXP20 → SBR-PKG-BOXP20-NEW
--
-- Idempotent: once applied, the old component_ids no longer appear in any
-- bill_of_materials row, so subsequent runs match zero rows. The JOIN
-- against items also guards against partial state — if the new SKU isn't
-- in items yet (e.g. fresh DB without seed data) the UPDATE is a no-op
-- rather than a foreign-key violation.
--
-- Apply against Railway manually:
--   psql "$DATABASE_URL" -f migration_swap_push_packaging_boxes.sql
--
-- Auto-applied on every boot via server/services/startup-checks.ts as
-- long as both old and new SKUs exist in items.

BEGIN;

-- Push 1.0 box swap
UPDATE bill_of_materials
SET component_id = new_box.id
FROM items AS old_box, items AS new_box
WHERE bill_of_materials.component_id = old_box.id
  AND old_box.sku = 'SBR-PKG-BOXP10'
  AND new_box.sku = 'SBR-PKG-BOXP10-NEW';

-- Push 2.0 box swap
UPDATE bill_of_materials
SET component_id = new_box.id
FROM items AS old_box, items AS new_box
WHERE bill_of_materials.component_id = old_box.id
  AND old_box.sku = 'SBR-PKG-BOXP20'
  AND new_box.sku = 'SBR-PKG-BOXP20-NEW';

COMMIT;
