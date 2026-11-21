create table workspaces (
  id uuid primary key,
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table workspace_devices (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  role text not null check (role in ('owner', 'member')),
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index workspace_devices_active
  on workspace_devices (workspace_id, created_at)
  where revoked_at is null;

create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by_device_id uuid references workspace_devices(id) on delete set null,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index workspace_invites_available
  on workspace_invites (workspace_id, expires_at)
  where consumed_at is null;

create table workspace_items (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'project', 'task', 'note', 'sprint', 'meeting', 'project_link', 'calendar_event'
  )),
  id text not null check (char_length(id) between 1 and 100),
  project_id text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_by_device_id uuid not null references workspace_devices(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_type, id),
  check (
    (entity_type in ('project', 'task', 'calendar_event') and project_id is null) or
    (entity_type in ('note', 'sprint', 'meeting', 'project_link') and project_id is not null)
  )
);

create index workspace_items_by_project
  on workspace_items (workspace_id, project_id)
  where project_id is not null;
