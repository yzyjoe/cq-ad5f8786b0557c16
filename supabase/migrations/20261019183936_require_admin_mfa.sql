-- Admin reads and writes require a verified second factor. Customers retain
-- their existing access to their own profile, order and order events.
create or replace function private.is_admin_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin())
    and coalesce((select auth.jwt() ->> 'aal') = 'aal2', false);
$$;

revoke all on function private.is_admin_mfa() from public, anon;
grant execute on function private.is_admin_mfa() to authenticated;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin_mfa()));

drop policy if exists orders_select_own_or_admin on public.orders;
create policy orders_select_own_or_admin
on public.orders for select to authenticated
using (
  (user_id = (select auth.uid()) and deleted_at is null)
  or (select private.is_admin_mfa())
);

drop policy if exists order_events_select_own_or_admin on public.order_events;
create policy order_events_select_own_or_admin
on public.order_events for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_events.order_id
      and (o.user_id = (select auth.uid()) or (select private.is_admin_mfa()))
  )
);

drop policy if exists admin_audit_log_select_admin on public.admin_audit_log;
create policy admin_audit_log_select_admin
on public.admin_audit_log for select to authenticated
using ((select private.is_admin_mfa()));

drop policy if exists "Admins view order QC" on storage.objects;
create policy "Admins view order QC"
on storage.objects for select to authenticated
using (bucket_id = 'order-qc' and (select private.is_admin_mfa()));
