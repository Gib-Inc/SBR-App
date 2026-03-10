-- Add category column to items table for grouping in inventory dashboard
ALTER TABLE items ADD COLUMN IF NOT EXISTS category TEXT;

-- Optional: index for fast group-by queries
CREATE INDEX IF NOT EXISTS items_category_idx ON items (category);
