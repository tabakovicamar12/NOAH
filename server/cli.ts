import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { ROLES } from '../src/app/core/models/domain.models';
import { hashPassword } from './auth';
import { loadConfig } from './config';
import { getDb, type Db } from './db';
import { loadDotEnv } from './env-file';
import { MIGRATIONS, migrate } from './migrations';
import { seedDemo } from './seed-demo';
import { createPhotoStore } from './storage';

/**
 * Administration from the command line. Accounts, projects and objects are created here (or directly in
 * Supabase); the app itself only reads them.
 *
 *   npm run cli -- migrate
 *   npm run cli -- sql                       print all migrations for the Supabase SQL editor
 *   npm run cli -- create-user --username admin --name "Ana Admin" --role ADMIN
 *   npm run cli -- create-user --username vodja --name "Maja Vidic" --role MANAGER
 *   npm run cli -- create-user --username delovodja --name "Rok Kralj" --role FOREMAN
 *   npm run cli -- create-user --username luka --name "Luka Kranjc" --role WORKER --crew "Ekipa A"
 *   npm run cli -- set-password --username luka
 *   npm run cli -- deactivate-user --username luka
 *   npm run cli -- assign-project --username vodja --project HN      manager leads project HN
 *   npm run cli -- assign-site --username delovodja --site HN-1      foreman leads object HN-1
 *   npm run cli -- create-project --code HN --name "Hiša Novak"
 *   npm run cli -- create-site --project HN --code HN-1 --name "Maribor, Tezno" --city Maribor
 *   npm run cli -- list
 *   npm run cli -- seed-demo                 synthetic demo data (never on a production database)
 *   npm run cli -- seed-demo --users-only    empty database with only the test accounts
 *   npm run cli -- purge-photos --dry-run    photos older than PHOTO_RETENTION_DAYS (or --days N): count only
 *   npm run cli -- purge-photos              …and delete them (files and records); run on a schedule
 */

type Args = Record<string, string | true>;

function parseArgs(argv: readonly string[]): { cmd: string; args: Args } {
  const [cmd = 'help', ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? '';
    if (!a.startsWith('--')) continue;
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[a.slice(2)] = next;
      i++;
    } else {
      args[a.slice(2)] = true;
    }
  }
  return { cmd, args };
}

function need(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`Missing --${key}`);
  return v.trim();
}

async function askPassword(prompt: string): Promise<string> {
  const fromEnv = process.env['AON_PASSWORD'];
  if (fromEnv) return fromEnv;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const pw = await rl.question(prompt);
    return pw;
  } finally {
    rl.close();
  }
}

function checkPassword(pw: string): void {
  if (pw.length < 10) throw new Error('Password must have at least 10 characters.');
}

async function run(db: Db, cmd: string, args: Args): Promise<void> {
  switch (cmd) {
    case 'migrate': {
      const applied = await migrate(db, (m) => console.log(`applied ${m}`));
      console.log(applied.length ? 'Done.' : 'Database is up to date.');
      return;
    }
    case 'sql': {
      console.log('create table if not exists schema_migrations (id text primary key, applied_at bigint not null);\n');
      for (const m of MIGRATIONS) {
        console.log(`-- ${m.id}\n${m.sql.trim()}\ninsert into schema_migrations (id, applied_at) values ('${m.id}', ${Date.now()}) on conflict do nothing;\n`);
      }
      return;
    }
    case 'create-user': {
      await migrate(db);
      const username = need(args, 'username').toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Username: 3–40 characters a-z, 0-9, . _ -');
      const role = need(args, 'role').toUpperCase();
      if (!(ROLES as readonly string[]).includes(role)) throw new Error(`--role must be one of ${ROLES.join(', ')}`);
      const pw = await askPassword(`Password for ${username} (min 10 characters): `);
      checkPassword(pw);
      await db.query(
        `insert into users (id, username, display_name, role, crew, password_hash, active, created_at) values ($1, $2, $3, $4, $5, $6, true, $7)`,
        [`u-${randomUUID()}`, username, need(args, 'name'), role, typeof args['crew'] === 'string' ? args['crew'] : null, await hashPassword(pw), Date.now()],
      );
      console.log(`Created ${role.toLowerCase()} ${username}.`);
      return;
    }
    case 'set-password': {
      const username = need(args, 'username').toLowerCase();
      const pw = await askPassword(`New password for ${username} (min 10 characters): `);
      checkPassword(pw);
      const rows = await db.query(`update users set password_hash = $2 where username = $1 returning id`, [username, await hashPassword(pw)]);
      console.log(rows.length ? 'Password changed.' : 'No such user.');
      return;
    }
    case 'deactivate-user': {
      const rows = await db.query(`update users set active = false where username = $1 returning id`, [need(args, 'username').toLowerCase()]);
      console.log(rows.length ? 'Deactivated. Their records are kept.' : 'No such user.');
      return;
    }
    case 'assign-project': {
      await migrate(db);
      const user = (await db.query(`select id from users where username = $1 and role = 'MANAGER'`, [need(args, 'username').toLowerCase()]))[0];
      if (!user) throw new Error('No such manager.');
      const project = (await db.query(`select id from projects where code = $1`, [need(args, 'project').toUpperCase()]))[0];
      if (!project) throw new Error('No such project.');
      await db.query(`insert into project_managers (project_id, user_id) values ($1, $2) on conflict do nothing`, [String(project['id']), String(user['id'])]);
      console.log('Assigned.');
      return;
    }
    case 'assign-site': {
      await migrate(db);
      const user = (await db.query(`select id from users where username = $1 and role = 'FOREMAN'`, [need(args, 'username').toLowerCase()]))[0];
      if (!user) throw new Error('No such foreman.');
      const site = (await db.query(`select id from sites where code = $1 and active`, [need(args, 'site').toUpperCase()]))[0];
      if (!site) throw new Error('No such object.');
      await db.query(`insert into site_foremen (site_id, user_id) values ($1, $2) on conflict do nothing`, [String(site['id']), String(user['id'])]);
      console.log('Assigned.');
      return;
    }
    case 'create-project': {
      await migrate(db);
      const code = need(args, 'code').toUpperCase();
      await db.query(`insert into projects (id, code, name, active, created_at) values ($1, $2, $3, true, $4)`, [`p-${randomUUID()}`, code, need(args, 'name'), Date.now()]);
      console.log(`Created project ${code}.`);
      return;
    }
    case 'create-site': {
      const projectCode = need(args, 'project').toUpperCase();
      const project = (await db.query(`select id from projects where code = $1`, [projectCode]))[0];
      if (!project) throw new Error(`No project with code ${projectCode}`);
      await db.query(`insert into sites (id, project_id, code, name, city, active, created_at) values ($1, $2, $3, $4, $5, true, $6)`, [
        `s-${randomUUID()}`,
        String(project['id']),
        need(args, 'code').toUpperCase(),
        need(args, 'name'),
        typeof args['city'] === 'string' ? args['city'] : '',
        Date.now(),
      ]);
      console.log(`Created object under ${projectCode}.`);
      return;
    }
    case 'list': {
      await migrate(db);
      const users = await db.query(`select username, display_name, role, crew, active from users order by role, display_name`);
      const projects = await db.query(`select p.code, p.name, count(s.id)::int as objects from projects p left join sites s on s.project_id = p.id group by p.id order by p.code`);
      console.table(users);
      console.table(projects);
      return;
    }
    case 'seed-demo': {
      if (process.env['NODE_ENV'] === 'production' && !args['force']) throw new Error('Refusing to seed demo data in production (add --force if you really mean it).');
      await migrate(db);
      await seedDemo(db, { usersOnly: !!args['users-only'] });
      console.log('Demo data loaded. Accounts: admin / admin-demo-2026, vodja / vodja-demo-2026, delovodja / delovodja-demo-2026, delavec / delavec-demo-2026 (other workers: demo-geslo-2026).');
      return;
    }
    case 'purge-photos': {
      // Storage limitation (GDPR Art. 5(1)(e)): photos are kept only as long as the employer decided.
      // Working-time records are never touched here; the law sets how long those are kept.
      await migrate(db);
      const days = typeof args['days'] === 'string' ? Number(args['days']) : loadConfig().org.photoRetentionDays;
      if (!days || !Number.isInteger(days) || days < 1) throw new Error('Set PHOTO_RETENTION_DAYS or pass --days N.');
      const cutoff = Date.now() - days * 86_400_000;
      const rows = await db.query<{ id: string; storage_key: string }>(`select id, storage_key from photos where created_at < $1`, [cutoff]);
      console.log(`${rows.length} photo(s) older than ${days} days.`);
      if (args['dry-run'] || rows.length === 0) return;
      const store = createPhotoStore(loadConfig());
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200);
        await store.remove(batch.map((r) => r.storage_key));
        await db.query(`delete from photos where id = any($1::text[])`, [batch.map((r) => r.id)]);
      }
      console.log('Deleted.');
      return;
    }
    default:
      console.log(
        'Commands: migrate | sql | create-user | set-password | deactivate-user | assign-project | assign-site | create-project | create-site | list | seed-demo | purge-photos',
      );
  }
}

loadDotEnv();
const { cmd, args } = parseArgs(process.argv.slice(2));
const config = loadConfig();
const db = await getDb(config);
try {
  await run(db, cmd, args);
} catch (err: unknown) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
