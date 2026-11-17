-- NEXT FORM production starter schema for Supabase.
-- Run this entire file in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  category text not null,
  price integer not null check (price > 0),
  old_price integer not null default 0 check (old_price >= 0),
  stock integer not null default 0 check (stock >= 0),
  sizes text[] not null default '{}',
  image_url text not null,
  description text not null default '',
  color text not null default '',
  featured boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  transaction_id text not null unique,
  customer jsonb not null,
  items jsonb not null,
  subtotal integer not null check (subtotal >= 0),
  delivery_fee integer not null default 0 check (delivery_fee >= 0),
  total integer not null check (total >= 0),
  payment_method text not null check (payment_method in ('sslcommerz','cod')),
  payment_status text not null default 'pending',
  order_status text not null default 'new',
  gateway_session_key text,
  gateway_validation jsonb,
  stock_deducted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_active_featured_idx on public.products (is_active, featured);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_transaction_id_idx on public.orders (transaction_id);

-- RLS is enabled. Public storefront reads are served through the server API;
-- browser clients cannot write products or read customer orders.
alter table public.admin_users enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;

create or replace function public.is_nf_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_nf_admin() from public;
grant execute on function public.is_nf_admin() to authenticated;

-- Keep table access server-only. These policies additionally document intent
-- and protect against accidentally exposing direct browser writes later.
drop policy if exists "admins can read own admin record" on public.admin_users;
create policy "admins can read own admin record" on public.admin_users
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "no direct product writes from clients" on public.products;
create policy "no direct product writes from clients" on public.products
  for all to authenticated using (public.is_nf_admin()) with check (public.is_nf_admin());

drop policy if exists "no customer order reads from browser" on public.orders;
create policy "no customer order reads from browser" on public.orders
  for select to authenticated using (public.is_nf_admin());

-- Public product reads may be performed through the Node server only.
-- Granting no anon table SELECT means the service-role-backed API is the public boundary.
revoke all on public.admin_users from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.orders from anon, authenticated;
grant select on public.admin_users to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select on public.orders to authenticated;

-- Public bucket for product images; upload and delete are admin-only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "product images are public to view" on storage.objects;
create policy "product images are public to view" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "only NF admins upload product images" on storage.objects;
create policy "only NF admins upload product images" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.is_nf_admin());

drop policy if exists "only NF admins update product images" on storage.objects;
create policy "only NF admins update product images" on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and public.is_nf_admin())
  with check (bucket_id = 'product-images' and public.is_nf_admin());

drop policy if exists "only NF admins delete product images" on storage.objects;
create policy "only NF admins delete product images" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.is_nf_admin());

-- Atomically check and deduct stock once a safe, validated online payment succeeds.
create or replace function public.nf_finalize_paid_order(
  p_order_id uuid,
  p_val_id text,
  p_gateway_validation jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.payment_status = 'paid' then return; end if;
  if v_order.payment_method <> 'sslcommerz' then raise exception 'Not an online payment order'; end if;

  if not v_order.stock_deducted then
    for v_item in select value from jsonb_array_elements(v_order.items)
    loop
      v_product_id := (v_item->>'product_id')::uuid;
      v_qty := (v_item->>'qty')::integer;
      update public.products set stock = stock - v_qty, updated_at = now()
        where id = v_product_id and stock >= v_qty;
      if not found then raise exception 'Insufficient stock for product %', v_product_id; end if;
    end loop;
  end if;

  update public.orders set payment_status = 'paid', order_status = 'confirmed',
    gateway_validation = p_gateway_validation, stock_deducted = true, updated_at = now()
    where id = p_order_id;
end;
$$;

-- COD orders reserve stock when the order is accepted. Admin can cancel and restock manually.
create or replace function public.nf_confirm_cod_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.payment_method <> 'cod' then raise exception 'Not a COD order'; end if;
  if v_order.stock_deducted then return; end if;

  for v_item in select value from jsonb_array_elements(v_order.items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::integer;
    update public.products set stock = stock - v_qty, updated_at = now()
      where id = v_product_id and stock >= v_qty;
    if not found then raise exception 'Insufficient stock for product %', v_product_id; end if;
  end loop;

  update public.orders set stock_deducted = true, order_status = 'confirmed', updated_at = now()
    where id = p_order_id;
end;
$$;

revoke all on function public.nf_finalize_paid_order(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.nf_confirm_cod_order(uuid) from public, anon, authenticated;
grant execute on function public.nf_finalize_paid_order(uuid, text, jsonb) to service_role;
grant execute on function public.nf_confirm_cod_order(uuid) to service_role;

-- Optional starter catalogue. Keep or delete these rows after replacing with real product photography.
insert into public.products (name, category, price, old_price, stock, sizes, image_url, description, color, featured)
select * from (values
 ('Essential Oversized Tee','T-Shirts',1490,1790,18,array['S','M','L','XL']::text[],'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=85','A relaxed everyday essential with a clean silhouette. Soft cotton feel, easy drape and a versatile fit.','Black',true),
 ('Form Heavyweight Hoodie','Hoodies',2890,3290,12,array['M','L','XL']::text[],'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=85','A structured, relaxed hoodie made for everyday layering. Minimal branding and an easy-to-style profile.','Black',true),
 ('Core Utility Overshirt','Shirts',2490,0,8,array['S','M','L','XL']::text[],'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=900&q=85','A versatile overshirt with a modern, understated look.','Stone',false),
 ('Structured Bomber Jacket','Outerwear',4590,4990,5,array['M','L','XL']::text[],'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=900&q=85','A clean outer layer with a confident shape. Designed to pair with your everyday wardrobe.','Black',true)
) as seed(name,category,price,old_price,stock,sizes,image_url,description,color,featured)
where not exists (select 1 from public.products);
