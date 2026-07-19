-- Fleet Copilot — initial schema
-- Multi-tenant: every row belongs to an organization; isolation is enforced
-- with Row-Level Security checked through the memberships table.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  registration text not null,
  vin text not null default '',
  make text not null,
  model text not null,
  mileage integer not null default 0 check (mileage >= 0),
  created_at timestamptz not null default now(),
  unique (org_id, registration)
);

create table public.service_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  type text not null check (type in ('oil', 'brakes', 'tires', 'battery', 'engine', 'other')),
  cost numeric(12, 2) not null check (cost >= 0),
  service_date date not null,
  notes text not null default '',
  receipt_url text,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan text not null check (plan in ('free', 'pro', 'business')),
  status text not null,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id)
);

-- Cached AI output (monthly summaries) + per-month AI usage metering
create table public.ai_summaries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  month text not null, -- YYYY-MM
  content text not null,
  created_at timestamptz not null default now(),
  unique (org_id, month)
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  month text not null, -- YYYY-MM
  question_count integer not null default 0,
  unique (org_id, month)
);

create index vehicles_org_idx on public.vehicles (org_id);
create index service_records_org_idx on public.service_records (org_id);
create index service_records_vehicle_idx on public.service_records (vehicle_id);
create index memberships_user_idx on public.memberships (user_id);

-- ---------------------------------------------------------------- RLS

-- security definer so policies can consult memberships without recursing
create or replace function public.is_org_member(org uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = org and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_owner(org uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = org and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.vehicles enable row level security;
alter table public.service_records enable row level security;
alter table public.subscriptions enable row level security;
alter table public.ai_summaries enable row level security;
alter table public.ai_usage enable row level security;

-- organizations: members read; any signed-in user may create one; owners update
create policy org_select on public.organizations
  for select to authenticated using (is_org_member(id));
create policy org_insert on public.organizations
  for insert to authenticated with check (true);
create policy org_update on public.organizations
  for update to authenticated using (is_org_owner(id));
create policy org_delete on public.organizations
  for delete to authenticated using (is_org_owner(id));

-- memberships: members of the org can see its roster; a user may create their
-- own membership (org creation flow); owners manage the rest
create policy membership_select on public.memberships
  for select to authenticated using (user_id = auth.uid() or is_org_member(org_id));
create policy membership_insert on public.memberships
  for insert to authenticated with check (user_id = auth.uid() or is_org_owner(org_id));
create policy membership_update on public.memberships
  for update to authenticated using (is_org_owner(org_id));
create policy membership_delete on public.memberships
  for delete to authenticated using (is_org_owner(org_id) or user_id = auth.uid());

-- org-scoped data: full access for members, nothing for anyone else
create policy vehicles_all on public.vehicles
  for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create policy service_records_all on public.service_records
  for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create policy subscriptions_select on public.subscriptions
  for select to authenticated using (is_org_member(org_id));
-- writes to subscriptions happen via the service role (Stripe webhook) only

create policy ai_summaries_select on public.ai_summaries
  for select to authenticated using (is_org_member(org_id));

create policy ai_usage_select on public.ai_usage
  for select to authenticated using (is_org_member(org_id));
-- ai_summaries / ai_usage writes happen via the service role (AI endpoint) only
