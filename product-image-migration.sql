-- Run once in Supabase Dashboard > SQL Editor before deploying the updated app.
-- Existing products stay valid; add the product-only image later from the admin form.
alter table public.products
  add column if not exists image_url_no_model text not null default '';
