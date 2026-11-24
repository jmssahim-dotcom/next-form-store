-- Run this once in Supabase Dashboard > SQL Editor.
-- Stores which catalogue product appears in the homepage showroom.

create table if not exists public.storefront_settings (
  id boolean primary key default true check (id),
  hero_product_id uuid references public.products(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.storefront_settings enable row level security;
revoke all on public.storefront_settings from anon, authenticated;
grant all on public.storefront_settings to service_role;

insert into public.storefront_settings (id, hero_product_id)
values (true, null)
on conflict (id) do nothing;
