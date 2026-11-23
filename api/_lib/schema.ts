// Orbit's Postgres schema (Neon). The API applies it automatically the first
// time it talks to a database whose schema is older than SCHEMA_VERSION, inside
// one transaction holding an advisory lock, so concurrent cold starts are safe.
// Every statement is idempotent. To change the schema, append statements and
// bump SCHEMA_VERSION; never edit statements that have already shipped.

export const SCHEMA_VERSION = 1;

export const SCHEMA_STATEMENTS: string[] = [
  `create table if not exists orbit_schema (
    version integer primary key,
    applied_at timestamptz not null default now()
  )`,

  // Workspaces. revision increases on every item change so devices can poll cheaply.
  `create table if not exists workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(trim(name)) between 1 and 80),
    revision bigint not null default 0,
    last_push_at timestamptz,
    created_at timestamptz not null default now()
  )`,

  // Each device holds its own revocable key; only its sha256 is stored.
  `create table if not exists workspace_devices (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    name text not null check (char_length(trim(name)) between 1 and 60),
    role text not null check (role in ('owner', 'member')),
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    revoked_at timestamptz
  )`,
  `create index if not exists workspace_devices_active
    on workspace_devices (workspace_id) where revoked_at is null`,

  `create table if not exists workspace_invites (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    created_by_device_id uuid references workspace_devices(id) on delete cascade,
    code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz not null,
    max_uses integer not null default 1 check (max_uses between 1 and 10),
    used_count integer not null default 0 check (used_count >= 0),
    created_at timestamptz not null default now()
  )`,

  `create table if not exists workspace_items (
    workspace_id uuid not null references workspaces(id) on delete cascade,
    entity_type text not null check (entity_type in (
      'project', 'task', 'note', 'sprint', 'meeting', 'project_link', 'calendar_event'
    )),
    id text not null check (char_length(id) between 1 and 100),
    project_id text,
    payload jsonb not null,
    updated_by_device_id uuid references workspace_devices(id) on delete set null,
    updated_at timestamptz not null default now(),
    primary key (workspace_id, entity_type, id),
    check (
      (entity_type in ('project', 'task', 'calendar_event') and project_id is null) or
      (entity_type in ('note', 'sprint', 'meeting', 'project_link') and project_id is not null)
    )
  )`,
  `create index if not exists workspace_items_by_project
    on workspace_items (workspace_id, project_id) where project_id is not null`,

  `create table if not exists activity_events (
    id bigint generated always as identity primary key,
    workspace_id uuid not null references workspaces(id) on delete cascade,
    device_id uuid references workspace_devices(id) on delete set null,
    entity_type text not null,
    entity_id text,
    label text,
    action text not null check (action in ('created', 'updated', 'deleted')),
    created_at timestamptz not null default now()
  )`,
  `create index if not exists activity_events_recent on activity_events (workspace_id, id desc)`,

  `create table if not exists push_subscriptions (
    endpoint text primary key,
    workspace_id uuid not null references workspaces(id) on delete cascade,
    device_id uuid references workspace_devices(id) on delete cascade,
    subscription jsonb not null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists push_subscriptions_by_workspace on push_subscriptions (workspace_id)`,
  `create index if not exists push_subscriptions_by_device on push_subscriptions (device_id)`,

  `create table if not exists google_calendar_connections (
    workspace_id uuid primary key references workspaces(id) on delete cascade,
    connected_by_device_id uuid references workspace_devices(id) on delete set null,
    encrypted_refresh_token text not null,
    calendar_id text not null default 'primary',
    connected_at timestamptz not null default now(),
    last_synced_at timestamptz
  )`,

  `create table if not exists google_calendar_mappings (
    workspace_id uuid not null references workspaces(id) on delete cascade,
    orbit_event_id text not null,
    google_event_id text not null,
    google_etag text,
    synced_orbit_updated_at timestamptz not null,
    synced_google_updated_at timestamptz not null,
    primary key (workspace_id, orbit_event_id),
    unique (workspace_id, google_event_id)
  )`,

  // Every item change writes an activity row and bumps the workspace revision.
  `create or replace function log_workspace_item_change()
  returns trigger
  language plpgsql
  as $$
  declare
    changed_row workspace_items%rowtype;
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

    insert into activity_events (workspace_id, device_id, entity_type, entity_id, label, action)
    values (
      changed_row.workspace_id,
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

    update workspaces set revision = revision + 1 where id = changed_row.workspace_id;

    if tg_op = 'DELETE' then return old; end if;
    return new;
  end;
  $$`,
  `drop trigger if exists workspace_items_activity on workspace_items`,
  `create trigger workspace_items_activity
    after insert or update or delete on workspace_items
    for each row execute function log_workspace_item_change()`,

  // Redeem an invite atomically: lock it, check it, add the device, count the use.
  `create or replace function redeem_workspace_invite(
    p_code_hash text,
    p_device_name text,
    p_token_hash text
  )
  returns table (workspace_id uuid, device_id uuid)
  language plpgsql
  as $$
  #variable_conflict use_column
  declare
    invite workspace_invites%rowtype;
    new_device_id uuid;
  begin
    select * into invite
      from workspace_invites
      where code_hash = p_code_hash
        and expires_at > now()
        and used_count < max_uses
      for update;
    if not found then
      raise exception 'Invite code is invalid or expired.' using errcode = 'P0001';
    end if;

    insert into workspace_devices (workspace_id, name, role, token_hash)
      values (invite.workspace_id, trim(p_device_name), 'member', p_token_hash)
      returning id into new_device_id;

    update workspace_invites set used_count = used_count + 1 where id = invite.id;

    return query select invite.workspace_id, new_device_id;
  end;
  $$`,

  // Apply one device's batch of changes in a single transaction.
  `create or replace function apply_workspace_sync(
    p_workspace_id uuid,
    p_device_id uuid,
    p_upserts jsonb,
    p_deletes jsonb
  )
  returns bigint
  language plpgsql
  as $$
  declare
    new_revision bigint;
  begin
    if not exists (
      select 1 from workspace_devices
      where id = p_device_id and workspace_id = p_workspace_id and revoked_at is null
    ) then
      raise exception 'Device access was revoked.' using errcode = 'P0001';
    end if;

    insert into workspace_items (
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
      where workspace_items.payload is distinct from excluded.payload
         or workspace_items.project_id is distinct from excluded.project_id;

    delete from workspace_items as existing
    using jsonb_to_recordset(coalesce(p_deletes, '[]'::jsonb)) as item(entity_type text, id text)
    where existing.workspace_id = p_workspace_id
      and existing.entity_type = item.entity_type
      and existing.id = item.id;

    select revision into new_revision from workspaces where id = p_workspace_id;
    return new_revision;
  end;
  $$`,

  // Claim the right to send a push for this workspace, at most once per window.
  `create or replace function claim_workspace_push(p_workspace_id uuid, p_window_seconds integer)
  returns boolean
  language sql
  as $$
    with claimed as (
      update workspaces
        set last_push_at = now()
        where id = p_workspace_id
          and (last_push_at is null or last_push_at < now() - make_interval(secs => p_window_seconds))
        returning 1
    )
    select exists (select 1 from claimed);
  $$`,

  `insert into orbit_schema (version) values (1) on conflict (version) do nothing`,
];
