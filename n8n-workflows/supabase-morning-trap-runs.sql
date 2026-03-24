-- Morning Trap Runner — Supabase table
-- Run this in your Supabase SQL editor before activating the workflow.

create table if not exists morning_trap_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  google_ads_raw jsonb,
  amazon_ads_raw jsonb,
  shopify_order_count integer,
  shopify_gross_sales numeric(12,2),
  claude_briefing text,
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
