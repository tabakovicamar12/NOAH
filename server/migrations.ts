import type { Db } from './db';

/**
 * Schema migrations, applied in order and recorded in schema_migrations. Kept in code (not loose .sql
 * files) so the serverless bundle carries them. `npm run cli -- sql` prints them for the Supabase SQL editor.
 *
 * Timestamps are epoch milliseconds (bigint) and calendar days are 'YYYY-MM-DD' text, exactly as the
 * app's offline store keeps them, so a record round-trips without time-zone drift.
 */
export const MIGRATIONS: ReadonlyArray<{ readonly id: string; readonly sql: string }> = [
  {
    id: '001_init',
    sql: `
create table if not exists users (
  id            text primary key,
  username      text not null unique check (username = lower(username)),
  display_name  text not null,
  role          text not null check (role in ('WORKER', 'MANAGER')),
  crew          text,
  password_hash text not null,
  active        boolean not null default true,
  created_at    bigint not null
);

create table if not exists projects (
  id         text primary key,
  code       text not null unique,
  name       text not null,
  active     boolean not null default true,
  created_at bigint not null
);

create table if not exists sites (
  id         text primary key,
  project_id text not null references projects(id),
  code       text not null,
  name       text not null,
  city       text not null default '',
  active     boolean not null default true,
  created_at bigint not null
);
create index if not exists sites_project_idx on sites(project_id);

create table if not exists order_counters (
  year integer primary key,
  last integer not null
);

create table if not exists work_orders (
  id                text primary key,
  code              text unique,
  title             text not null,
  description       text not null default '',
  project_id        text not null references projects(id),
  site_id           text not null references sites(id),
  location          text not null default '',
  manager_id        text not null references users(id),
  status            text not null check (status in ('NEW', 'IN_PROGRESS', 'COMPLETED', 'ISSUE')),
  published         boolean not null default false,
  unit              text not null check (unit in ('PCS', 'M', 'M2', 'M3', 'H')),
  planned_qty       numeric not null check (planned_qty > 0),
  done_qty          numeric not null default 0,
  estimated_minutes integer,
  materials         jsonb not null default '[]'::jsonb,
  date              text check (date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
  due_date          text check (due_date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
  updated_at        bigint not null,
  created_at        bigint not null
);
create index if not exists work_orders_site_idx on work_orders(site_id);

create table if not exists work_order_crew (
  order_id text not null references work_orders(id) on delete cascade,
  user_id  text not null references users(id),
  primary key (order_id, user_id)
);
create index if not exists work_order_crew_user_idx on work_order_crew(user_id);

create table if not exists time_entries (
  id            text primary key,
  user_id       text not null references users(id),
  kind          text not null check (kind in ('SHIFT', 'ORDER')),
  work_order_id text references work_orders(id),
  date          text not null check (date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
  started_at    bigint not null,
  ended_at      bigint,
  end_source    text check (end_source in ('TAP', 'DECLARED')),
  end_note      text,
  received_at   bigint not null,
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists time_entries_user_date_idx on time_entries(user_id, date);
create index if not exists time_entries_order_idx on time_entries(work_order_id);

create table if not exists logs (
  id            text primary key,
  user_id       text not null references users(id),
  work_order_id text not null references work_orders(id),
  kind          text not null check (kind in ('QUANTITY', 'NOTE', 'ISSUE')),
  quantity      numeric,
  text          text,
  created_at    bigint not null
);
create index if not exists logs_order_idx on logs(work_order_id);

create table if not exists photos (
  id                text primary key,
  user_id           text not null references users(id),
  work_order_id     text not null references work_orders(id),
  project_id        text not null,
  category          text not null check (category in ('BEFORE', 'IN_PROGRESS', 'FINISHED', 'ISSUE')),
  caption           text,
  width             integer not null,
  height            integer not null,
  created_at        bigint not null,
  privacy_confirmed boolean not null,
  mask_count        integer not null default 0,
  storage_key       text not null,
  size_bytes        integer not null
);
create index if not exists photos_order_idx on photos(work_order_id);
create index if not exists photos_user_idx on photos(user_id, created_at);

create table if not exists daily_summaries (
  id            text primary key,
  user_id       text not null references users(id),
  date          text not null check (date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
  arrival_at    bigint,
  departure_at  bigint,
  shift_minutes integer not null,
  order_minutes integer not null,
  lines         jsonb not null,
  orders_worked jsonb not null,
  issues_reported integer not null,
  photos_taken  integer not null,
  declared_end  boolean not null,
  corrections   jsonb not null,
  comment       text not null default '',
  status        text not null check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED')),
  submitted_at  bigint,
  reviewed_at   bigint,
  reviewer_name text,
  reviewer_note text
);
create index if not exists daily_summaries_date_idx on daily_summaries(date);

create table if not exists consents (
  user_id     text not null references users(id),
  version     text not null,
  accepted_at bigint not null,
  primary key (user_id, version)
);

create table if not exists idempotency (
  key        text primary key,
  user_id    text not null,
  created_at bigint not null
);
`,
  },
  {
    id: '002_lock_down',
    // Supabase exposes every public table through its REST API with the anon key. The AON server is the
    // only client (it connects as the database owner), so row-level security with no policies shuts that
    // side door without affecting the API.
    sql: `
alter table users enable row level security;
alter table projects enable row level security;
alter table sites enable row level security;
alter table order_counters enable row level security;
alter table work_orders enable row level security;
alter table work_order_crew enable row level security;
alter table time_entries enable row level security;
alter table logs enable row level security;
alter table photos enable row level security;
alter table daily_summaries enable row level security;
alter table consents enable row level security;
alter table idempotency enable row level security;
alter table schema_migrations enable row level security;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('photos', 'photos', false, 8388608, array['image/jpeg'])
    on conflict (id) do nothing;
  end if;
end $$;
`,
  },
  {
    id: '003_project_admins',
    // Managers flagged here may add projects and objects from the app.
    sql: `
alter table users add column if not exists can_manage_projects boolean not null default false;
`,
  },
  {
    id: '004_unwrap_json_strings',
    // Before the `$n::text::jsonb` fix, postgres.js stored JSON arrays as JSON strings ("[...]"). Unwrap them.
    sql: `
update work_orders set materials = (materials #>> '{}')::jsonb where jsonb_typeof(materials) = 'string';
update daily_summaries set lines = (lines #>> '{}')::jsonb where jsonb_typeof(lines) = 'string';
update daily_summaries set orders_worked = (orders_worked #>> '{}')::jsonb where jsonb_typeof(orders_worked) = 'string';
update daily_summaries set corrections = (corrections #>> '{}')::jsonb where jsonb_typeof(corrections) = 'string';
`,
  },
  {
    id: '005_roles_and_scopes',
    // Four roles (administrator, manager, foreman, worker). Managers lead projects, foremen lead objects; an
    // administrator assigns both. Existing managers keep seeing what they saw: they are assigned to every project.
    // The old "may add projects" flag becomes the administrator role, and a database without an administrator
    // promotes its longest-standing active manager so someone can still manage accounts.
    sql: `
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('ADMIN', 'MANAGER', 'FOREMAN', 'WORKER'));
update users set role = 'ADMIN' where can_manage_projects;
alter table users drop column if exists can_manage_projects;
update users set role = 'ADMIN'
  where id = (select id from users where role = 'MANAGER' and active order by created_at, id limit 1)
    and not exists (select 1 from users where role = 'ADMIN' and active);

create table if not exists project_managers (
  project_id text not null references projects(id),
  user_id    text not null references users(id),
  primary key (project_id, user_id)
);
create index if not exists project_managers_user_idx on project_managers(user_id);

create table if not exists site_foremen (
  site_id text not null references sites(id),
  user_id text not null references users(id),
  primary key (site_id, user_id)
);
create index if not exists site_foremen_user_idx on site_foremen(user_id);

insert into project_managers (project_id, user_id)
  select p.id, u.id from projects p cross join users u where u.role = 'MANAGER'
  on conflict do nothing;

alter table project_managers enable row level security;
alter table site_foremen enable row level security;
`,
  },
  {
    id: '006_project_numbers',
    sql: `
create table if not exists project_counters (
  year integer primary key,
  last integer not null
);
alter table project_counters enable row level security;
`,
  },
  {
    id: '007_more_units',
    sql: `
alter table work_orders drop constraint if exists work_orders_unit_check;
alter table work_orders add constraint work_orders_unit_check check (unit in ('PCS', 'M', 'M2', 'M3', 'H', 'KG', 'T', 'KPL'));
`,
  },
  {
    id: '008_shift_site',
    // ZAČNI DELO records the object the worker chose; the daily report keeps its name as it was that day.
    sql: `
alter table time_entries add column if not exists site_id text references sites(id);
create index if not exists time_entries_site_idx on time_entries(site_id, date);
alter table daily_summaries add column if not exists site_name text;
`,
  },
  {
    id: '009_change_marker',
    // The time of the last recorded change, so the desk can poll for news without loading the whole day.
    sql: `
create table if not exists change_marker (
  id         integer primary key check (id = 1),
  changed_at bigint not null
);
alter table change_marker enable row level security;
`,
  },
];

export async function migrate(db: Db, log: (msg: string) => void = () => undefined): Promise<string[]> {
  await db.query(`create table if not exists schema_migrations (id text primary key, applied_at bigint not null)`);
  const done = new Set((await db.query<{ id: string }>(`select id from schema_migrations`)).map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.tx(async (tx) => {
      for (const statement of splitSql(m.sql)) await tx.query(statement);
      await tx.query(`insert into schema_migrations (id, applied_at) values ($1, $2)`, [m.id, Date.now()]);
    });
    log(`applied ${m.id}`);
    applied.push(m.id);
  }
  return applied;
}

/** Splits on top-level semicolons, keeping $$ … $$ blocks intact. */
export function splitSql(source: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < source.length; i++) {
    if (source.startsWith('$$', i)) {
      inDollar = !inDollar;
      buf += '$$';
      i++;
      continue;
    }
    const ch = source[i] ?? '';
    if (ch === ';' && !inDollar) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
