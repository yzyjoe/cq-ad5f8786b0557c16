-- Order numbers are business identifiers, not authentication secrets.
-- Rotate every existing public lookup to an independent, unguessable token.
alter table public.orders
  add column if not exists public_tracking_token text;

update public.orders
set public_tracking_token = upper(replace(gen_random_uuid()::text, '-', ''))
where public_tracking_token is null;

alter table public.orders
  alter column public_tracking_token set default upper(replace(gen_random_uuid()::text, '-', '')),
  alter column public_tracking_token set not null;

alter table public.orders
  add constraint orders_public_tracking_token_format
  check (public_tracking_token ~ '^[A-F0-9]{32}$');

create unique index orders_public_tracking_token_idx
on public.orders (public_tracking_token);

-- QC photos must never be delivered from GitHub Pages. Customers receive
-- short-lived signed URLs only after authenticated Storage RLS checks.
insert into storage.buckets (id, name, public)
values ('order-qc', 'order-qc', false)
on conflict (id) do update set public = false;

create policy "Customers view their own order QC"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-qc'
  and exists (
    select 1 from public.orders o
    where lower(o.order_code) = split_part(name, '/', 1)
      and o.deleted_at is null
      and o.user_id = (select auth.uid())
  )
);

create policy "Admins view order QC"
on storage.objects
for select
to authenticated
using (bucket_id = 'order-qc' and (select private.is_admin()));
