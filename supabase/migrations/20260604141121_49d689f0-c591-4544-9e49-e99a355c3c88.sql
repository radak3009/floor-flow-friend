create table if not exists public.machine_overrides (
  monitoring_id text primary key,
  patch jsonb not null default '{}'::jsonb,
  expected jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_machine_overrides_expires on public.machine_overrides (expires_at);

grant all on public.machine_overrides to service_role;

alter table public.machine_overrides enable row level security;

create policy machine_overrides_deny_select on public.machine_overrides
  for select using (false);
create policy machine_overrides_deny_insert on public.machine_overrides
  for insert with check (false);
create policy machine_overrides_deny_update on public.machine_overrides
  for update using (false);
create policy machine_overrides_deny_delete on public.machine_overrides
  for delete using (false);