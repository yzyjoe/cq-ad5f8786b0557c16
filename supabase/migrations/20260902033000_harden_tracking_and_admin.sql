alter table public.orders
  add column if not exists image_url text,
  add column if not exists public_tracking_enabled boolean not null default true,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_reason text;

create index if not exists orders_deleted_by_idx on public.orders (deleted_by)
where deleted_by is not null;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('order_created', 'order_updated', 'order_archived', 'order_restored', 'order_hard_deleted')),
  order_id bigint,
  order_code_snapshot text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists admin_audit_log_occurred_idx
on public.admin_audit_log (occurred_at desc);

create index if not exists admin_audit_log_order_idx
on public.admin_audit_log (order_id, occurred_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists admin_audit_log_select_admin on public.admin_audit_log;
create policy admin_audit_log_select_admin
on public.admin_audit_log
for select
to authenticated
using ((select private.is_admin()));

revoke all on table public.admin_audit_log from public, anon, authenticated;
grant select on table public.admin_audit_log to authenticated;

create or replace function private.is_admin_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_admin())
    and (
      not exists (
        select 1
        from auth.mfa_factors factor
        where factor.user_id = (select auth.uid())
          and factor.status = 'verified'
      )
      or coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
    );
$$;

revoke all on function private.is_admin_mfa() from public, anon;
grant execute on function private.is_admin_mfa() to authenticated;

drop policy if exists orders_select_own_or_admin on public.orders;
create policy orders_select_own_or_admin
on public.orders
for select
to authenticated
using (
  (
    user_id = (select auth.uid())
    and deleted_at is null
  )
  or (select private.is_admin())
);

drop policy if exists orders_insert_admin on public.orders;
create policy orders_insert_admin
on public.orders
for insert
to authenticated
with check ((select private.is_admin_mfa()));

drop policy if exists orders_update_admin on public.orders;
create policy orders_update_admin
on public.orders
for update
to authenticated
using ((select private.is_admin_mfa()))
with check ((select private.is_admin_mfa()));

drop policy if exists orders_delete_admin on public.orders;
drop policy if exists order_events_insert_admin on public.order_events;
drop policy if exists order_events_update_admin on public.order_events;
drop policy if exists order_events_delete_admin on public.order_events;

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;

revoke all on table public.orders from public, anon, authenticated;
grant select, insert, update on table public.orders to authenticated;

revoke all on table public.order_events from public, anon, authenticated;
grant select on table public.order_events to authenticated;

create or replace function private.audit_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
  audit_order_id bigint;
  audit_order_code text;
  audit_details jsonb;
begin
  if tg_op = 'INSERT' then
    audit_action := 'order_created';
    audit_order_id := new.id;
    audit_order_code := new.order_code;
    audit_details := jsonb_build_object('status', new.status);
  elsif tg_op = 'DELETE' then
    audit_action := 'order_hard_deleted';
    audit_order_id := old.id;
    audit_order_code := old.order_code;
    audit_details := jsonb_build_object('status', old.status);
  else
    audit_order_id := new.id;
    audit_order_code := new.order_code;
    if old.deleted_at is null and new.deleted_at is not null then
      audit_action := 'order_archived';
    elsif old.deleted_at is not null and new.deleted_at is null then
      audit_action := 'order_restored';
    else
      audit_action := 'order_updated';
    end if;
    audit_details := jsonb_build_object(
      'old_status', old.status,
      'new_status', new.status,
      'tracking_changed', old.tracking_code is distinct from new.tracking_code,
      'public_tracking_changed', old.public_tracking_enabled is distinct from new.public_tracking_enabled
    );
  end if;

  insert into public.admin_audit_log (
    admin_user_id,
    action,
    order_id,
    order_code_snapshot,
    details
  ) values (
    (select auth.uid()),
    audit_action,
    audit_order_id,
    audit_order_code,
    audit_details
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_order_change() from public, anon, authenticated;

drop trigger if exists orders_admin_audit on public.orders;
create trigger orders_admin_audit
after insert or update or delete on public.orders
for each row execute function private.audit_order_change();

create table if not exists public.tracking_rate_limits (
  key_hash text primary key check (char_length(key_hash) = 64),
  window_started_at timestamptz not null default now(),
  attempts smallint not null default 1 check (attempts between 1 and 32767),
  updated_at timestamptz not null default now()
);

alter table public.tracking_rate_limits enable row level security;
revoke all on table public.tracking_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.tracking_rate_limits to service_role;

create or replace function public.consume_tracking_rate_limit(p_key_hash text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_attempts smallint;
begin
  if p_key_hash is null or char_length(p_key_hash) <> 64 then
    return false;
  end if;

  insert into public.tracking_rate_limits as limits (
    key_hash,
    window_started_at,
    attempts,
    updated_at
  ) values (
    p_key_hash,
    now(),
    1,
    now()
  )
  on conflict (key_hash) do update
  set
    attempts = case
      when limits.window_started_at < now() - interval '10 minutes' then 1
      else limits.attempts + 1
    end,
    window_started_at = case
      when limits.window_started_at < now() - interval '10 minutes' then now()
      else limits.window_started_at
    end,
    updated_at = now()
  returning attempts into current_attempts;

  delete from public.tracking_rate_limits
  where updated_at < now() - interval '2 days';

  return current_attempts <= 12;
end;
$$;

revoke all on function public.consume_tracking_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_tracking_rate_limit(text) to service_role;
