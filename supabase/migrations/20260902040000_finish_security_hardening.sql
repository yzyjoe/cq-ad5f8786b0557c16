create index if not exists admin_audit_log_admin_user_idx
on public.admin_audit_log (admin_user_id)
where admin_user_id is not null;

drop policy if exists tracking_rate_limits_deny_client_access
on public.tracking_rate_limits;

create policy tracking_rate_limits_deny_client_access
on public.tracking_rate_limits
for all
to anon, authenticated
using (false)
with check (false);
