-- Run once in Supabase Dashboard > SQL Editor.
-- Adds a public GLB model library. Uploading and replacing models is only available to signed-in store admins via the app server.

alter table public.storefront_settings
  add column if not exists hero_model_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('3d-models', '3d-models', true, 20971520, array['model/gltf-binary','application/octet-stream'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "NEXT FORM GLB models are public to view" on storage.objects;
create policy "NEXT FORM GLB models are public to view" on storage.objects
  for select using (bucket_id = '3d-models');

drop policy if exists "Only NEXT FORM server uploads GLB models" on storage.objects;
create policy "Only NEXT FORM server uploads GLB models" on storage.objects
  for insert to service_role with check (bucket_id = '3d-models');
