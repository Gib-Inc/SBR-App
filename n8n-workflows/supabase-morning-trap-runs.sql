-- Morning Trap Runner — Supabase table
-- Run this in your Supabase SQL editor before activating the workflow.

create table if not exists morning_trap_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,

  -- Google Ads MTD
  google_ads_raw jsonb,

  -- Amazon Ads MTD
  amazon_ads_raw jsonb,

  -- Shopify MTD
  shopify_order_count integer,
  shopify_gross_sales numeric(12,2),
  shopify_source_breakdown jsonb,  -- { "web": { orders: N, revenue: N }, "no_referrer": { ... } }
  shopify_refund_count integer default 0,

  -- Claude briefing
  claude_briefing text,

  -- SMS delivery
  sms_sent boolean default false,
  sms_sent_at timestamptz,

  created_at timestamptz default now()
);

-- Index for quick lookups by date
create index if not exists idx_morning_trap_runs_date on morning_trap_runs(run_date desc);

-- RLS: service key bypasses, but lock down anon access
alter table morning_trap_runs enable row level security;

create policy "Service key full access" on morning_trap_runs
  for all using (true) with check (true);
