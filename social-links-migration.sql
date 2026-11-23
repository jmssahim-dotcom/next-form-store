-- Run this once in Supabase Dashboard > SQL Editor for the existing NEXT FORM database.
create table if not exists public.store_social_links (
  id boolean primary key default true check (id),
  facebook text not null default '',
  instagram text not null default '',
  tiktok text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.store_social_links enable row level security;
revoke all on public.store_social_links from anon, authenticated;
grant all on public.store_social_links to service_role;

insert into public.store_social_links (id, facebook, instagram, tiktok)
values (true, 'https://www.facebook.com/1460494087150407?locale=en_US', 'https://www.instagram.com/next_form.official', '')
on conflict (id) do nothing;
