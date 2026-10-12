import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { hashPassword } from './auth';
import { loadConfig } from './config';
import { getDb, type Db } from './db';
import { loadDotEnv } from './env-file';
import { MIGRATIONS, migrate } from './migrations';
import { seedDemo } from './seed-demo';

/**
 * Administration from the command line. Accounts, projects and objects are created here (or directly in
 * Supabase); the app itself only reads them.
 *
 *   npm run cli -- migrate
 *   npm run cli -- sql                       print all migrations for the Supabase SQL editor
 *   npm run cli -- create-user --username vodja --name "Maja Vidic" --role MANAGER [--projects]
 *   npm run cli -- create-user --username luka --name "Luka Kranjc" --role WORKER --crew "Ekipa A"
 *   npm run cli -- set-password --username luka
 *   npm run cli -- deactivate-user --username luka
 *   npm run cli -- grant-projects --username vodja    manager may add projects and objects in the app
 *   npm run cli -- revoke-projects --username vodja
 *   npm run cli -- create-project --code HN --name "Hiša Novak"
 *   npm run cli -- create-site --project HN --code HN-1 --name "Maribor, Tezno" --city Maribor
 *   npm run cli -- list
 *   npm run cli -- seed-demo                 synthetic demo data (never on a production database)
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
      if (role !== 'WORKER' && role !== 'MANAGER') throw new Error('--role must be WORKER or MANAGER');
      const canManageProjects = args['projects'] === true;
      if (canManageProjects && role !== 'MANAGER') throw new Error('--projects is only for managers');
      const pw = await askPassword(`Password for ${username} (min 10 characters): `);
      checkPassword(pw);
      await db.query(
        `insert into users (id, username, display_name, role, crew, password_hash, active, created_at, can_manage_projects) values ($1, $2, $3, $4, $5, $6, true, $7, $8)`,
        [`u-${randomUUID()}`, username, need(args, 'name'), role, typeof args['crew'] === 'string' ? args['crew'] : null, await hashPassword(pw), Date.now(), canManageProjects],
      );
      console.log(`Created ${role.toLowerCase()} ${username}${canManageProjects ? ' (may add projects)' : ''}.`);
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
    case 'grant-projects':
    case 'revoke-projects': {
      await migrate(db);
      const grant = cmd === 'grant-projects';
      const rows = await db.query(`update users set can_manage_projects = $2 where username = $1 and role = 'MANAGER' returning id`, [
        need(args, 'username').toLowerCase(),
        grant,
      ]);
      console.log(rows.length ? (grant ? 'Granted: may add projects and objects (log in again to see it).' : 'Revoked.') : 'No such manager.');
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
      const users = await db.query(`select username, display_name, role, crew, active, can_manage_projects as projects from users order by role, display_name`);
      const projects = await db.query(`select p.code, p.name, count(s.id)::int as objects from projects p left join sites s on s.project_id = p.id group by p.id order by p.code`);
      console.table(users);
      console.table(projects);
      return;
    }
    case 'seed-demo': {
      if (process.env['NODE_ENV'] === 'production' && !args['force']) throw new Error('Refusing to seed demo data in production (add --force if you really mean it).');
      await migrate(db);
      await seedDemo(db);
      console.log('Demo data loaded. Accounts: vodja / vodja-demo-2026, delavec / delavec-demo-2026 (others: demo-geslo-2026).');
      return;
    }
    default:
      console.log('Commands: migrate | sql | create-user | set-password | deactivate-user | grant-projects | revoke-projects | create-project | create-site | list | seed-demo');
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
