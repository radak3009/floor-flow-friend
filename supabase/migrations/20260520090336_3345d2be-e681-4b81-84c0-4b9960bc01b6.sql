create table public.pwa_config (
  id int primary key default 1 check (id = 1),
  name text not null default 'MES Shop Floor',
  short_name text not null default 'MES',
  theme_color text not null default '#1f2937',
  background_color text not null default '#1f2937',
  icon_192_url text,
  icon_512_url text,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.pwa_config (id) values (1) on conflict do nothing;

alter table public.pwa_config enable row level security;

create policy "pwa_config_read_all" on public.pwa_config for select using (true);
create policy "pwa_config_deny_insert" on public.pwa_config for insert with check (false);
create policy "pwa_config_deny_update" on public.pwa_config for update using (false);
create policy "pwa_config_deny_delete" on public.pwa_config for delete using (false);

insert into storage.buckets (id, name, public) values ('pwa-icons', 'pwa-icons', true) on conflict do nothing;

create policy "pwa_icons_public_read" on storage.objects for select using (bucket_id = 'pwa-icons');
create policy "pwa_icons_deny_write" on storage.objects for insert with check (false);
create policy "pwa_icons_deny_update" on storage.objects for update using (false);
create policy "pwa_icons_deny_delete" on storage.objects for delete using (false);