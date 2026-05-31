-- Run this if you already ran the OLD schema (login required).
-- Supabase → SQL Editor → paste → Run

drop policy if exists "crew_select" on public.crew_state;
drop policy if exists "crew_update" on public.crew_state;
drop policy if exists "crew_insert" on public.crew_state;
drop policy if exists "crew_select_anon" on public.crew_state;
drop policy if exists "crew_update_anon" on public.crew_state;
drop policy if exists "crew_insert_anon" on public.crew_state;

create policy "crew_select_anon"
  on public.crew_state for select
  to anon
  using (true);

create policy "crew_update_anon"
  on public.crew_state for update
  to anon
  using (id = 'crew')
  with check (id = 'crew');

create policy "crew_insert_anon"
  on public.crew_state for insert
  to anon
  with check (id = 'crew');
