create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  display_name text not null default 'Orbit member',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses between 1 and 10),
  used_count integer not null default 0 check (used_count >= 0),
  created_at timestamptz not null default now()
);

create table public.workspace_items (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'project', 'task', 'note', 'sprint', 'meeting', 'project_link', 'calendar_event'
  )),
  id text not null check (char_length(id) between 1 and 100),
  project_id text,
  payload jsonb not null,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_type, id),
  check (
    (entity_type in ('project', 'task', 'calendar_event') and project_id is null) or
    (entity_type in ('note', 'sprint', 'meeting', 'project_link') and project_id is not null)
  )
);

create index workspace_items_by_project
  on public.workspace_items (workspace_id, project_id)
  where project_id is not null;

create table public.activity_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  created_at timestamptz not null default now()
);

create table public.push_subscriptions (
  endpoint text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_by_workspace
  on public.push_subscriptions (workspace_id, user_id);

create table public.google_calendar_connections (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  connected_by uuid not null references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  calendar_id text not null default 'primary',
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create table public.google_calendar_mappings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  orbit_event_id text not null,
  google_event_id text not null,
  google_etag text,
  synced_orbit_updated_at timestamptz not null,
  synced_google_updated_at timestamptz not null,
  primary key (workspace_id, orbit_event_id),
  unique (workspace_id, google_event_id)
);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
    and exists (
      select 1
      from public.workspace_members
      where workspace_id = target_workspace_id
        and user_id = auth.uid()
    );
$$;

revoke all on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;

create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_workspace_id uuid;
  member_name text;
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Authenticator verification is required.';
  end if;
  if char_length(trim(p_name)) not between 1 and 80 then
    raise exception 'Workspace name must be between 1 and 80 characters.';
  end if;

  member_name := coalesce(
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'display_name'), ''),
    nullif(split_part(auth.jwt() ->> 'email', '@', 1), ''),
    'Orbit member'
  );

  insert into public.workspaces (name, created_by)
  values (trim(p_name), auth.uid())
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, display_name)
  values (new_workspace_id, auth.uid(), 'owner', member_name);

  return new_workspace_id;
end;
$$;

revoke all on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;

create or replace function public.join_workspace_with_code(p_code_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invite public.workspace_invites%rowtype;
  member_name text;
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Authenticator verification is required.';
  end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invite code is invalid or expired.';
  end if;

  select *
    into invite
    from public.workspace_invites
    where code_hash = p_code_hash
      and expires_at > now()
      and used_count < max_uses
    for update;

  if not found then
    raise exception 'Invite code is invalid or expired.';
  end if;

  if exists (
    select 1 from public.workspace_members
    where workspace_id = invite.workspace_id and user_id = auth.uid()
  ) then
    return invite.workspace_id;
  end if;

  member_name := coalesce(
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'display_name'), ''),
    nullif(split_part(auth.jwt() ->> 'email', '@', 1), ''),
    'Orbit member'
  );

  insert into public.workspace_members (workspace_id, user_id, role, display_name)
  values (invite.workspace_id, auth.uid(), 'member', member_name);

  update public.workspace_invites
  set used_count = used_count + 1
  where id = invite.id;

  return invite.workspace_id;
end;
$$;

revoke all on function public.join_workspace_with_code(text) from public, anon;
grant execute on function public.join_workspace_with_code(text) to authenticated;

create or replace function public.sync_workspace_items(
  p_workspace_id uuid,
  p_upserts jsonb,
  p_deletes jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied.';
  end if;

  insert into public.workspace_items (
    workspace_id, entity_type, id, project_id, payload, updated_by, updated_at
  )
  select
    p_workspace_id,
    item.entity_type,
    item.id,
    item.project_id,
    item.payload,
    auth.uid(),
    now()
  from jsonb_to_recordset(coalesce(p_upserts, '[]'::jsonb)) as item(
    entity_type text,
    id text,
    project_id text,
    payload jsonb
  )
  on conflict (workspace_id, entity_type, id) do update
  set project_id = excluded.project_id,
      payload = excluded.payload,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

  delete from public.workspace_items as existing
  using jsonb_to_recordset(coalesce(p_deletes, '[]'::jsonb)) as item(
    entity_type text,
    id text
  )
  where existing.workspace_id = p_workspace_id
    and existing.entity_type = item.entity_type
    and existing.id = item.id;
end;
$$;

revoke all on function public.sync_workspace_items(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.sync_workspace_items(uuid, jsonb, jsonb) to authenticated;

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

  insert into public.activity_events (workspace_id, actor_id, entity_type, action)
  values (changed_row.workspace_id, changed_row.updated_by, changed_row.entity_type, event_action);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger workspace_items_activity
after insert or update or delete on public.workspace_items
for each row execute function public.log_workspace_item_change();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.workspace_items enable row level security;
alter table public.activity_events enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_mappings enable row level security;

create policy "Workspace members can read their workspaces"
  on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));

create policy "Workspace members can read membership"
  on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can read their invites"
  on public.workspace_invites for select to authenticated
  using (created_by = auth.uid() and public.is_workspace_member(workspace_id));

create policy "Workspace members can create invites"
  on public.workspace_invites for insert to authenticated
  with check (
    created_by = auth.uid()
    and expires_at > now()
    and public.is_workspace_member(workspace_id)
  );

create policy "Workspace members can read shared items"
  on public.workspace_items for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can add shared items"
  on public.workspace_items for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and updated_by = auth.uid());

create policy "Workspace members can update shared items"
  on public.workspace_items for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id) and updated_by = auth.uid());

create policy "Workspace members can remove shared items"
  on public.workspace_items for delete to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can read activity"
  on public.activity_events for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Users manage their own push subscriptions"
  on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id))
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));

grant select on public.workspaces, public.workspace_members, public.workspace_invites,
  public.workspace_items, public.activity_events to authenticated;
grant insert, update, delete on public.workspace_invites to authenticated;
grant select, insert, update, delete on public.workspace_items to authenticated;
grant select on public.push_subscriptions to authenticated;
grant insert, update, delete on public.push_subscriptions to authenticated;
revoke all on public.google_calendar_connections, public.google_calendar_mappings from anon, authenticated;
grant all on public.google_calendar_connections, public.google_calendar_mappings to service_role;

alter table public.workspace_items replica identity full;
alter publication supabase_realtime add table public.workspace_items;
