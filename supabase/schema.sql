-- Run once in Supabase: SQL Editor → New query → paste → Run

create table if not exists public.crew_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.crew_state (id, payload)
values ('crew', '{}'::jsonb)
on conflict (id) do nothing;

alter table public.crew_state enable row level security;

drop policy if exists "crew_select" on public.crew_state;
drop policy if exists "crew_update" on public.crew_state;
drop policy if exists "crew_insert" on public.crew_state;

create policy "crew_select"
  on public.crew_state for select
  to authenticated
  using (true);

create policy "crew_update"
  on public.crew_state for update
  to authenticated
  using (true)
  with check (id = 'crew');

create policy "crew_insert"
  on public.crew_state for insert
  to authenticated
  with check (id = 'crew');
