-- CrewCore mobile app: "update available" prompt.
--
-- One row per platform. After a new build is live on the Play Store /
-- App Store, bump latest_version and every older install shows an
-- "Update available" prompt on its next open. Set min_version to force it
-- (the prompt can't be dismissed while the install is below min_version).
--
--   update public.app_releases
--      set latest_version = '1.1.20', notes = 'New leave calendar', updated_at = now()
--    where platform in ('android', 'ios');
--
-- Readable before login (the check runs on app open); writable only via SQL
-- / service role.

create table if not exists public.app_releases (
  platform       text primary key check (platform in ('android', 'ios')),
  latest_version text not null,
  min_version    text,
  notes          text,
  updated_at     timestamptz not null default now()
);

alter table public.app_releases enable row level security;

drop policy if exists app_releases_read on public.app_releases;
create policy app_releases_read on public.app_releases
  for select to anon, authenticated using (true);

-- Supabase's default privileges grant everything to anon/authenticated;
-- keep this table read-only for them even if RLS is ever relaxed.
revoke all on public.app_releases from anon, authenticated;
grant select on public.app_releases to anon, authenticated;

insert into public.app_releases (platform, latest_version)
values ('android', '1.1.19'), ('ios', '1.1.19')
on conflict (platform) do nothing;
