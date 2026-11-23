-- Orbit device-key access model.
--
-- The client was built for "no account, no password" access: a one-time invite
-- code gives a device a revocable key, stored as an HttpOnly cookie. The first
-- migration assumed Supabase Auth users with MFA, which no client ever used.
-- This migration moves every table to device identities. All reads and writes
-- go through the Vercel API with the service role, so table grants to the
-- browser roles are removed.

-- 1. Devices -----------------------------------------------------------------

create table public.workspace_devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  role text not null check (role in ('owner', 'member')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index workspace_devices_active
  on public.workspace_devices (workspace_id)
  where revoked_at is null;

-- 2. Detach existing tables from auth.users ----------------------------------

alter table public.workspaces
  alter column created_by drop not null,
  add column revision bigint not null default 0,
  add column last_push_at timestamptz;

alter table public.workspace_invites
  alter column created_by drop not null,
  add column created_by_device_id uuid references public.workspace_devices(id) on delete cascade;

alter table public.workspace_items
  alter column updated_by drop not null,
  add column updated_by_device_id uuid references public.workspace_devices(id) on delete set null;

alter table public.activity_events
  add column device_id uuid references public.workspace_devices(id) on delete set null,
  add column entity_id text,
  add column label text;

alter table public.push_subscriptions
  alter column user_id drop not null,
  add column device_id uuid references public.workspace_devices(id) on delete cascade;

create index push_subscriptions_by_device on public.push_subscriptions (device_id);

alter table public.google_calendar_connections
  alter column connected_by drop not null,
  add column connected_by_device_id uuid references public.workspace_devices(id) on delete set null;

-- The old updated_by = auth.uid() rule no longer applies.
drop policy if exists "Workspace members can add shared items" on public.workspace_items;
drop policy if exists "Workspace members can update shared items" on public.workspace_items;

-- 3. Activity log and revision counter -----------------------------------------
-- Every change bumps workspaces.revision, so devices can poll cheaply
-- ("has anything changed since revision N?") instead of downloading everything.

create or replace function public.log_workspace_item_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed_row public.workspace_items%rowtype;
  event_action text;
begin
  if tg_op = 'DELETE' then
    changed_row := old;
    event_action := 'deleted';
  elsif tg_op = 'INSERT' then
    changed_row := new;
    event_action := 'created';
  else
    changed_row := new;
    event_action := 'updated';
  end if;

  insert into public.activity_events (
    workspace_id, actor_id, device_id, entity_type, entity_id, label, action
  ) values (
    changed_row.workspace_id,
    changed_row.updated_by,
    changed_row.updated_by_device_id,
    changed_row.entity_type,
    changed_row.id,
    left(coalesce(
      changed_row.payload ->> 'title',
      changed_row.payload ->> 'name',
      changed_row.payload ->> 'label'
    ), 120),
    event_action
  );

  update public.workspaces
    set revision = revision + 1
    where id = changed_row.workspace_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- 4. Server-side operations (service role only) --------------------------------

-- Redeem an invite atomically: lock it, check it, add the device, count the use.
create or replace function public.redeem_workspace_invite(
  p_code_hash text,
  p_device_name text,
  p_token_hash text
)
returns table (workspace_id uuid, device_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  invite public.workspace_invites%rowtype;
  new_device_id uuid;
begin
  select * into invite
    from public.workspace_invites
    where code_hash = p_code_hash
      and expires_at > now()
      and used_count < max_uses
    for update;
  if not found then
    raise exception 'Invite code is invalid or expired.' using errcode = 'P0001';
  end if;

  insert into public.workspace_devices (workspace_id, name, role, token_hash)
    values (invite.workspace_id, trim(p_device_name), 'member', p_token_hash)
    returning id into new_device_id;

  update public.workspace_invites
    set used_count = used_count + 1
    where id = invite.id;

  return query select invite.workspace_id, new_device_id;
end;
$$;

-- Apply one device's batch of changes in a single transaction.
create or replace function public.apply_workspace_sync(
  p_workspace_id uuid,
  p_device_id uuid,
  p_upserts jsonb,
  p_deletes jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_revision bigint;
begin
  if not exists (
    select 1 from public.workspace_devices
    where id = p_device_id and workspace_id = p_workspace_id and revoked_at is null
  ) then
    raise exception 'Device access was revoked.' using errcode = 'P0001';
  end if;

  insert into public.workspace_items (
    workspace_id, entity_type, id, project_id, payload, updated_by_device_id, updated_at
  )
  select p_workspace_id, item.entity_type, item.id, item.project_id, item.payload, p_device_id, now()
  from jsonb_to_recordset(coalesce(p_upserts, '[]'::jsonb)) as item(
    entity_type text, id text, project_id text, payload jsonb
  )
  on conflict (workspace_id, entity_type, id) do update
    set project_id = excluded.project_id,
        payload = excluded.payload,
        updated_by_device_id = excluded.updated_by_device_id,
        updated_at = excluded.updated_at
    where public.workspace_items.payload is distinct from excluded.payload
       or public.workspace_items.project_id is distinct from excluded.project_id;

  delete from public.workspace_items as existing
  using jsonb_to_recordset(coalesce(p_deletes, '[]'::jsonb)) as item(entity_type text, id text)
  where existing.workspace_id = p_workspace_id
    and existing.entity_type = item.entity_type
    and existing.id = item.id;

  select revision into new_revision from public.workspaces where id = p_workspace_id;
  return new_revision;
end;
$$;

-- Claim the right to send a push for this workspace, at most once per window.
-- Stops a 50-item restore from sending 50 notifications to every device.
create or replace function public.claim_workspace_push(p_workspace_id uuid, p_window_seconds integer)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with claimed as (
    update public.workspaces
      set last_push_at = now()
      where id = p_workspace_id
        and (last_push_at is null or last_push_at < now() - make_interval(secs => p_window_seconds))
      returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke all on function public.redeem_workspace_invite(text, text, text) from public, anon, authenticated;
revoke all on function public.apply_workspace_sync(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.claim_workspace_push(uuid, integer) from public, anon, authenticated;
grant execute on function public.redeem_workspace_invite(text, text, text) to service_role;
grant execute on function public.apply_workspace_sync(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.claim_workspace_push(uuid, integer) to service_role;

-- The old user-based RPCs cannot be called by device clients.
revoke all on function public.create_workspace(text) from authenticated;
revoke all on function public.join_workspace_with_code(text) from authenticated;
revoke all on function public.sync_workspace_items(uuid, jsonb, jsonb) from authenticated;

-- 5. Lock tables to the server ---------------------------------------------------

alter table public.workspace_devices enable row level security;

revoke all on
  public.workspaces, public.workspace_members, public.workspace_invites,
  public.workspace_items, public.activity_events, public.push_subscriptions,
  public.workspace_devices
from anon, authenticated;

grant all on
  public.workspaces, public.workspace_members, public.workspace_invites,
  public.workspace_items, public.activity_events, public.push_subscriptions,
  public.workspace_devices
to service_role;
