create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'customer'
    check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_idx on public.profiles (lower(email));

create table public.orders (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_code text not null unique,
  product_name text not null,
  model_code text,
  quantity smallint not null default 1 check (quantity between 1 and 99),
  status text not null default 'submitted'
    check (status in ('submitted', 'accepted', 'purchased', 'logistics', 'warehouse', 'shipped', 'delivered', 'cancelled')),
  carrier text,
  tracking_code text,
  total_amount numeric(12,2) check (total_amount is null or total_amount >= 0),
  currency text not null default 'BRL' check (char_length(currency) = 3),
  notes text,
  ordered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_user_updated_idx on public.orders (user_id, updated_at desc);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  status text not null
    check (status in ('submitted', 'accepted', 'purchased', 'logistics', 'warehouse', 'shipped', 'delivered', 'cancelled')),
  description text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index order_events_order_occurred_idx on public.order_events (order_id, occurred_at desc);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public;
revoke all on function private.is_admin() from anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function private.sync_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    case
      when lower(coalesce(new.email, '')) = 'kicknity@gmail.com' then 'admin'
      else 'customer'
    end
  )
  on conflict (id) do update
  set email = excluded.email,
      role = excluded.role,
      updated_at = now();

  return new;
end;
$$;

revoke all on function private.sync_user_profile() from public;
revoke all on function private.sync_user_profile() from anon;
revoke all on function private.sync_user_profile() from authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.sync_user_profile();

create trigger on_auth_user_email_changed
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function private.sync_user_profile();

insert into public.profiles (id, email, full_name, role)
select
  u.id,
  coalesce(u.email, ''),
  nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
  case
    when lower(coalesce(u.email, '')) = 'kicknity@gmail.com' then 'admin'
    else 'customer'
  end
from auth.users u
on conflict (id) do update
set email = excluded.email,
    role = excluded.role,
    updated_at = now();

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public;
revoke all on function private.touch_updated_at() from anon;
revoke all on function private.touch_updated_at() from authenticated;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_updated_at();

create trigger orders_touch_updated_at
before update on public.orders
for each row execute function private.touch_updated_at();

create or replace function private.order_status_description(status_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case status_value
    when 'submitted' then 'Pedido recebido. Aguardando atendimento.'
    when 'accepted' then 'O agente assumiu o pedido e está falando com o vendedor.'
    when 'purchased' then 'Produto comprado.'
    when 'logistics' then 'Transportadora e rastreio atualizados.'
    when 'warehouse' then 'Produto recebido no armazém e em inspeção de qualidade.'
    when 'shipped' then 'Pedido enviado para o destino.'
    when 'delivered' then 'Pedido entregue.'
    when 'cancelled' then 'Pedido cancelado.'
    else 'Status do pedido atualizado.'
  end;
$$;

revoke all on function private.order_status_description(text) from public;
revoke all on function private.order_status_description(text) from anon;
revoke all on function private.order_status_description(text) from authenticated;

create or replace function private.log_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.order_events (order_id, status, description, occurred_at)
    values (
      new.id,
      new.status,
      private.order_status_description(new.status),
      case when tg_op = 'INSERT' then new.ordered_at else now() end
    );
  end if;
  return new;
end;
$$;

revoke all on function private.log_order_status() from public;
revoke all on function private.log_order_status() from anon;
revoke all on function private.log_order_status() from authenticated;

create trigger orders_log_initial_status
after insert on public.orders
for each row execute function private.log_order_status();

create trigger orders_log_status_change
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function private.log_order_status();

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;

create policy profiles_select_own_or_admin
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select private.is_admin())
);

create policy orders_select_own_or_admin
on public.orders
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_admin())
);

create policy orders_insert_admin
on public.orders
for insert
to authenticated
with check ((select private.is_admin()));

create policy orders_update_admin
on public.orders
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy orders_delete_admin
on public.orders
for delete
to authenticated
using ((select private.is_admin()));

create policy order_events_select_own_or_admin
on public.order_events
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_events.order_id
      and (
        o.user_id = (select auth.uid())
        or (select private.is_admin())
      )
  )
);

create policy order_events_insert_admin
on public.order_events
for insert
to authenticated
with check ((select private.is_admin()));

create policy order_events_update_admin
on public.order_events
for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy order_events_delete_admin
on public.order_events
for delete
to authenticated
using ((select private.is_admin()));

revoke all on table public.profiles from anon;
revoke all on table public.orders from anon;
revoke all on table public.order_events from anon;

grant select on table public.profiles to authenticated;
grant select, insert, update, delete on table public.orders to authenticated;
grant select, insert, update, delete on table public.order_events to authenticated;
grant usage, select on all sequences in schema public to authenticated;
