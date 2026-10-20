import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type {
  AdminUser,
  AdminUserCreate,
  AdminUserUpdate,
  AdminUsersResponse,
  AssignmentUpdate,
  ConsentRequest,
  HoursResponse,
  LoginConsents,
  LoginRequest,
  LoginResponse,
  ManagerDirectoryResponse,
  ManagerOverviewResponse,
  ManagerProjectsResponse,
  OrderOverview,
  OrgInfo,
  PasswordReset,
  PhotoView,
  ProjectCreate,
  ProjectUpdate,
  SiteCreate,
  SiteUpdate,
  SummaryDetailResponse,
  SummaryReviewRequest,
  WorkOrderDetailResponse,
  WorkOrderStatusRequest,
  WorkOrderUpsert,
  WorkerDayResponse,
  WorkerOverview,
} from '../src/app/core/models/api.models';
import {
  CONSENT_VERSION,
  PHOTO_CATEGORIES,
  QUANTITY_UNITS,
  ROLES,
  canApproveReports,
  isDeskRole,
  type CrewMember,
  type DailySummary,
  type IsoDate,
  type LogEntry,
  type PhotoMeta,
  type Role,
  type TimeEntry,
  type WorkOrderStatus,
} from '../src/app/core/models/domain.models';
import { LoginThrottle, hashPassword, issueToken, readFileKey, readToken, verifyPassword } from './auth';
import type { ServerConfig } from './config';
import { getDb, type Db, type SqlParam } from './db';
import {
  SITE_SELECT,
  loadOrders,
  publicUser,
  toLog,
  toPhoto,
  toProject,
  toSite,
  toSummary,
  toTimeEntry,
  toUser,
  type UserRow,
} from './rows';
import { projectInScope, scopeOf, siteInScope, summaryInScope, type Scope } from './scope';
import { isMonth, monthOf, monthWindow } from '../src/app/core/worktime/worktime';
import { createPhotoStore, readLocalPhoto, type PhotoStore } from './storage';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ALLOWED_TRANSITIONS: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  NEW: ['IN_PROGRESS', 'ISSUE'],
  IN_PROGRESS: ['COMPLETED', 'ISSUE', 'IN_PROGRESS'],
  ISSUE: ['IN_PROGRESS', 'ISSUE', 'COMPLETED'],
  COMPLETED: ['COMPLETED'],
};
const OPEN_STATUSES: readonly WorkOrderStatus[] = ['NEW', 'IN_PROGRESS', 'ISSUE'];
const DAY_MS = 86_400_000;

type Env = { Variables: { me: UserRow; db: Db } };

// ---------- validation helpers ----------

function requireString(value: unknown, field: string, max = 4000): string {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${field} is required`);
  return value.slice(0, max);
}
function optionalString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
}
function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `${field} must be a number`);
  return value;
}
function requireDate(value: unknown, field: string): IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${field} must be YYYY-MM-DD`);
  }
  return value as IsoDate;
}
function requireMonth(value: unknown): string {
  if (typeof value !== 'string' || !isMonth(value)) throw new HttpError(400, 'month must be YYYY-MM');
  return value;
}
/** Work order number: year and a running number, at least three digits (2026-007, 2026-125). */
export function orderNumber(year: number, n: number): string {
  return `${year}-${String(n).padStart(3, '0')}`;
}
/** Project number, issued by the server: P-2026-001. */
export function projectNumber(year: number, n: number): string {
  return `P-${year}-${String(n).padStart(3, '0')}`;
}
function optionalDate(value: unknown, field: string): IsoDate | null {
  return value === null || value === undefined || value === '' ? null : requireDate(value, field);
}
/** Project and object codes: short, upper-case, no spaces (e.g. HN, HN-1). */
function requireCode(value: unknown): string {
  const code = requireString(value, 'code', 40).trim().toUpperCase();
  if (!/^[\p{L}\p{N}._-]{1,20}$/u.test(code)) throw new HttpError(400, 'INVALID_CODE');
  return code;
}
function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
}
function requireId(value: unknown, field: string): string {
  if (!isId(value)) throw new HttpError(400, `${field} is invalid`);
  return value;
}
async function jsonBody<T>(c: Context): Promise<T> {
  try {
    const body: unknown = await c.req.json();
    if (!body || typeof body !== 'object') throw new Error('not an object');
    return body as T;
  } catch {
    throw new HttpError(400, 'JSON body required');
  }
}
function requireRole(value: unknown): Role {
  if (typeof value !== 'string' || !(ROLES as readonly string[]).includes(value)) throw new HttpError(400, 'role invalid');
  return value as Role;
}
function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 200) throw new HttpError(400, 'PASSWORD_TOO_SHORT');
  return value;
}
/** Every id must be an active account with the given role; returns them de-duplicated. */
async function requireUsersWithRole(db: Db, value: unknown, role: Role): Promise<string[]> {
  if (!Array.isArray(value)) throw new HttpError(400, 'userIds required');
  const ids = [...new Set(value.filter(isId))];
  const ok = await db.query(`select id from users where role = $1 and active and id = any($2::text[])`, [role, ids]);
  if (ok.length !== ids.length) throw new HttpError(400, `Every user must be an active ${role.toLowerCase()}`);
  return ids;
}
async function adminUsers(db: Db): Promise<AdminUser[]> {
  const [users, managed, led, open] = await Promise.all([
    db.query(`select * from users order by active desc, display_name`),
    db.query(`select pm.user_id, p.id, p.code, p.name from project_managers pm join projects p on p.id = pm.project_id where p.active order by p.code`),
    db.query(
      `select sf.user_id, s.id, s.code, s.name, p.id as project_id, p.code as project_code, p.name as project_name
       from site_foremen sf join sites s on s.id = sf.site_id join projects p on p.id = s.project_id
       where s.active and p.active order by s.code`,
    ),
    db.query(
      `select c.user_id, count(*)::int as n from work_order_crew c join work_orders o on o.id = c.order_id
       where o.published and o.status = any($1::text[]) group by c.user_id`,
      [[...OPEN_STATUSES]],
    ),
  ]);
  const openBy = new Map(open.map((r) => [String(r['user_id']), Number(r['n'])]));
  return users.map((r) => {
    const u = toUser(r);
    const sites = led.filter((s) => String(s['user_id']) === u.id);
    const fromSites = sites.map((s) => ({ id: String(s['project_id']), code: String(s['project_code']), name: String(s['project_name']) }));
    const projects =
      u.role === 'MANAGER'
        ? managed.filter((p) => String(p['user_id']) === u.id).map((p) => ({ id: String(p['id']), code: String(p['code']), name: String(p['name']) }))
        : [...new Map(fromSites.map((p) => [p.id, p])).values()];
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      crew: u.crew ?? null,
      active: u.active,
      projects,
      sites: sites.map((s) => ({ id: String(s['id']), code: String(s['code']), name: String(s['name']) })),
      openOrders: openBy.get(u.id) ?? 0,
    };
  });
}
async function inCrew(db: Db, orderId: string, userId: string): Promise<boolean> {
  return (await db.query(`select 1 from work_order_crew where order_id = $1 and user_id = $2`, [orderId, userId])).length > 0;
}
/** The account's current notice acknowledgement and newest voice decision, so another device need not ask again. */
async function loginConsents(db: Db, userId: string): Promise<LoginConsents> {
  const rows = await db.query(`select version, accepted_at from consents where user_id = $1 order by accepted_at desc`, [userId]);
  const pick = (r: Record<string, unknown> | undefined): { version: string; acceptedAt: number } | null =>
    r ? { version: String(r['version']), acceptedAt: Number(r['accepted_at']) } : null;
  return {
    notice: pick(rows.find((r) => r['version'] === CONSENT_VERSION)),
    voice: pick(rows.find((r) => String(r['version']).startsWith('voice-'))),
  };
}
/** "Projekt · Objekt" for each object chosen at ZAČNI DELO, in the order they were chosen. */
async function shiftSiteNames(db: Db, shifts: readonly TimeEntry[]): Promise<string | null> {
  const ids = [...new Set(shifts.map((s) => s.siteId).filter((id): id is string => !!id))];
  if (!ids.length) return null;
  const rows = await db.query(`${SITE_SELECT} where s.id = any($1::text[])`, [ids]);
  const byId = new Map(rows.map(toSite).map((s) => [s.id, `${s.projectName} · ${s.name}`]));
  return ids.map((id) => byId.get(id) ?? '').filter(Boolean).join(', ') || null;
}
function minutesBetween(start: number, end: number): number {
  return Math.max(0, Math.floor((end - start) / 60_000));
}
function today(): IsoDate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` as IsoDate;
}

/**
 * Runs a mutation exactly once per Idempotency-Key. The key is claimed inside the same transaction as
 * the change, so a failed mutation leaves the key free for the device's retry.
 */
async function idempotent(c: Context<Env>, fn: (db: Db) => Promise<void>): Promise<Response> {
  const key = c.req.header('Idempotency-Key');
  if (!key || key.length > 100) throw new HttpError(400, 'Idempotency-Key header required');
  const me = c.get('me');
  await c.get('db').tx(async (tx) => {
    const claimed = await tx.query(
      `insert into idempotency (key, user_id, created_at) values ($1, $2, $3) on conflict (key) do nothing returning key`,
      [key, me.id, Date.now()],
    );
    if (claimed.length === 0) return;
    await fn(tx);
    await markChanged(tx);
  });
  return c.body(null, 204);
}

/** One row with the time of the last recorded change: the desk polls it cheaply and reloads only on news. */
async function markChanged(db: Db): Promise<void> {
  await db.query(`insert into change_marker (id, changed_at) values (1, $1) on conflict (id) do update set changed_at = excluded.changed_at`, [Date.now()]);
}

// ---------- app ----------

export function createApp(config: ServerConfig): Hono<Env> {
  const app = new Hono<Env>();
  const photos: PhotoStore = createPhotoStore(config);
  const throttle = new LoginThrottle();
  const api = new Hono<Env>();

  app.use('/api/*', secureHeaders({ crossOriginResourcePolicy: 'same-origin' }));
  if (config.corsOrigins.length) {
    app.use('/api/*', cors({ origin: [...config.corsOrigins], allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'], maxAge: 600 }));
  }

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ message: err.message }, err.status as 400);
    console.error('[AON api] unhandled', err);
    return c.json({ message: 'Server error' }, 500);
  });
  app.notFound((c) => c.json({ message: `No route for ${c.req.method} ${c.req.path}` }, 404));

  api.use('*', async (c, next) => {
    c.set('db', await getDb(config));
    c.header('Cache-Control', 'no-store');
    await next();
  });

  // ---- public
  api.get('/health', (c) => c.json({ ok: true, serverTime: Date.now() }));

  api.post('/auth/login', async (c) => {
    const body = await jsonBody<LoginRequest>(c);
    const username = requireString(body.username, 'username', 80).trim().toLowerCase();
    const password = requireString(body.password, 'password', 200);
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    const keys = [`u:${username}`, `ip:${ip}`];
    if (throttle.blocked(keys)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
    const rows = await c.get('db').query(`select * from users where username = $1`, [username]);
    const user = rows[0] ? toUser(rows[0]) : null;
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      throttle.fail(keys);
      throw new HttpError(401, 'INVALID_CREDENTIALS');
    }
    if ((body.role === 'WORKER') !== (user.role === 'WORKER')) throw new HttpError(403, 'ROLE_MISMATCH');
    throttle.clear(keys);
    const { token, expiresAt } = await issueToken(config, { sub: user.id, role: user.role });
    return c.json({ token, expiresAt, user: publicUser(user), consents: await loginConsents(c.get('db'), user.id) } satisfies LoginResponse);
  });

  /** The employer behind this installation: named in the privacy notice (GDPR Art. 13) and on printed reports. */
  api.get('/org', (c) => c.json(config.org satisfies OrgInfo));

  /** Local photo store only: serves a file for a signed, short-lived key. */
  api.get('/files', async (c) => {
    const key = await readFileKey(config, c.req.query('t') ?? '');
    if (!key) throw new HttpError(403, 'Link expired');
    const bytes = await readLocalPhoto(config, key);
    if (!bytes) throw new HttpError(404, 'File not found');
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' });
  });

  // ---- everything below requires a session
  api.use('*', async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const claims = header.startsWith('Bearer ') ? await readToken(config, header.slice(7)) : null;
    if (!claims) throw new HttpError(401, 'Missing or expired token');
    const rows = await c.get('db').query(`select * from users where id = $1`, [claims.sub]);
    const me = rows[0] ? toUser(rows[0]) : null;
    if (!me || !me.active) throw new HttpError(401, 'Account disabled');
    c.set('me', me);
    await next();
  });
  /** Administrator, manager or foreman; what they may touch is narrowed further by their scope. */
  const deskOnly = async (c: Context<Env>, next: () => Promise<void>): Promise<void> => {
    if (!isDeskRole(c.get('me').role)) throw new HttpError(403, 'Forbidden for this role');
    await next();
  };
  /** Report approval: administrator or manager, never the foreman who runs the crew. */
  const approverOnly = async (c: Context<Env>, next: () => Promise<void>): Promise<void> => {
    if (!canApproveReports(c.get('me').role)) throw new HttpError(403, 'Forbidden for this role');
    await next();
  };
  /** Accounts, projects, objects and who leads them. */
  const adminOnly = async (c: Context<Env>, next: () => Promise<void>): Promise<void> => {
    if (c.get('me').role !== 'ADMIN') throw new HttpError(403, 'Forbidden for this role');
    await next();
  };
  const workerOnly = async (c: Context<Env>, next: () => Promise<void>): Promise<void> => {
    if (c.get('me').role !== 'WORKER') throw new HttpError(403, 'Forbidden for this role');
    await next();
  };

  // ---- worker
  api.get('/worker/orders', workerOnly, async (c) => {
    const me = c.get('me');
    // Open orders, plus completed ones from the last two weeks so the worker still sees recent work.
    const orders = await loadOrders(
      c.get('db'),
      `where o.published and exists (select 1 from work_order_crew w where w.order_id = o.id and w.user_id = $1)
       and (o.status <> 'COMPLETED' or o.updated_at > $2) order by o.created_at`,
      [me.id, Date.now() - 14 * DAY_MS],
    );
    // Objects to choose from at ZAČNI DELO: a worker can be sent to any active object, not only those with an order.
    const sites = (await c.get('db').query(`${SITE_SELECT} where s.active and p.active order by p.name, s.name`)).map(toSite);
    return c.json({ orders, sites, serverTime: Date.now() });
  });

  api.get('/worker/daily-summary', workerOnly, async (c) => {
    const date = requireDate(c.req.query('date'), 'date');
    const rows = await c.get('db').query(`select * from daily_summaries where id = $1`, [`sum-${c.get('me').id}-${date}`]);
    return c.json(rows[0] ? toSummary(rows[0]) : null);
  });

  // The worker's own records of a day from every device: a report written on one phone counts the time tapped on another.
  api.get('/worker/day', workerOnly, async (c) => {
    const me = c.get('me');
    const date = requireDate(c.req.query('date'), 'date');
    const from = requireNumber(Number(c.req.query('from')), 'from');
    const db = c.get('db');
    const [entries, logs] = await Promise.all([
      db.query(`select * from time_entries where user_id = $1 and (date = $2 or ended_at is null) order by started_at`, [me.id, date]),
      db.query(`select * from logs where user_id = $1 and created_at >= $2 and created_at < $3 order by created_at`, [me.id, from, from + 26 * 3_600_000]),
    ]);
    const res: WorkerDayResponse = { timeEntries: entries.map(toTimeEntry), logs: logs.map(toLog) };
    return c.json(res);
  });

  api.get('/worker/hours', workerOnly, async (c) => {
    const month = requireMonth(c.req.query('month') ?? today().slice(0, 7));
    return c.json(await hours(c.get('db'), month, [c.get('me').id]));
  });

  api.post('/consents', async (c) => {
    const body = await jsonBody<ConsentRequest>(c);
    const version = requireString(body.version, 'version', 60);
    const acceptedAt = requireNumber(body.acceptedAt, 'acceptedAt');
    return idempotent(c, async (db) => {
      await db.query(
        `insert into consents (user_id, version, accepted_at) values ($1, $2, $3) on conflict (user_id, version) do update set accepted_at = excluded.accepted_at`,
        [c.get('me').id, version, acceptedAt],
      );
    });
  });

  api.put('/time-entries/:id', async (c) => {
    const body = await jsonBody<TimeEntry>(c);
    const me = c.get('me');
    return idempotent(c, async (db) => {
      if (body.id !== c.req.param('id') || !isId(body.id)) throw new HttpError(400, 'id mismatch');
      if (body.userId !== me.id) throw new HttpError(403, 'Not your time entry');
      if (body.kind !== 'SHIFT' && body.kind !== 'ORDER') throw new HttpError(400, 'kind invalid');
      const startedAt = requireNumber(body.startedAt, 'startedAt');
      const endedAt = body.endedAt === null ? null : requireNumber(body.endedAt, 'endedAt');
      if (endedAt !== null && endedAt < startedAt) throw new HttpError(400, 'endedAt before startedAt');
      if (startedAt > Date.now() + 5 * 60_000) throw new HttpError(400, 'startedAt is in the future');
      const date = requireDate(body.date, 'date');
      if (body.kind === 'ORDER') {
        const order = await db.query(`select 1 from work_orders where id = $1`, [requireId(body.workOrderId, 'workOrderId')]);
        if (!order.length) throw new HttpError(404, 'Work order not found');
      }
      const siteId = body.kind === 'SHIFT' && body.siteId != null ? requireId(body.siteId, 'siteId') : null;
      const existing = (await db.query(`select * from time_entries where id = $1 for update`, [body.id]))[0];
      if (!existing && siteId && !(await db.query(`select 1 from sites where id = $1`, [siteId])).length) {
        throw new HttpError(404, 'Object not found');
      }
      // A new order segment needs the worker on the order's crew. Closing a segment already recorded is always allowed.
      if (!existing && body.kind === 'ORDER' && !(await inCrew(db, String(body.workOrderId), me.id))) {
        throw new HttpError(403, 'Not in this crew');
      }
      if (existing) {
        const prev = toTimeEntry(existing);
        // Tamper evidence: a recorded start never moves, and a recorded end is final.
        if (prev.startedAt !== startedAt) throw new HttpError(409, 'A recorded start cannot be changed');
        if (prev.endedAt !== null && prev.endedAt !== endedAt) throw new HttpError(409, 'A recorded end cannot be changed');
        if (prev.endedAt !== null) return;
        await db.query(`update time_entries set ended_at = $2, end_source = $3, end_note = $4 where id = $1`, [
          body.id,
          endedAt,
          body.endSource === 'DECLARED' ? 'DECLARED' : endedAt === null ? null : 'TAP',
          optionalString(body.endNote, 500),
        ]);
        return;
      }
      await db.query(
        `insert into time_entries (id, user_id, kind, work_order_id, site_id, date, started_at, ended_at, end_source, end_note, received_at)
         values ($1, $2, $3, $4, $11, $5, $6, $7, $8, $9, $10)`,
        [
          body.id,
          me.id,
          body.kind,
          body.kind === 'ORDER' ? body.workOrderId : null,
          date,
          startedAt,
          endedAt,
          endedAt === null ? null : body.endSource === 'DECLARED' ? 'DECLARED' : 'TAP',
          optionalString(body.endNote, 500),
          Date.now(),
          siteId,
        ],
      );
    });
  });

  api.post('/work-orders/:id/status', async (c) => {
    const body = await jsonBody<WorkOrderStatusRequest>(c);
    const me = c.get('me');
    const id = requireId(c.req.param('id'), 'id');
    return idempotent(c, async (db) => {
      const current = (await db.query(`select status, site_id from work_orders where id = $1 for update`, [id]))[0];
      if (!current) throw new HttpError(404, 'Work order not found');
      const allowed =
        (await inCrew(db, id, me.id)) || (isDeskRole(me.role) && siteInScope(await scopeOf(db, me), String(current['site_id'])));
      if (!allowed) throw new HttpError(403, 'Not in this crew');
      const status = String(current['status']) as WorkOrderStatus;
      // A crewmate who was offline may still start or flag an order someone else already finished: no-op.
      if (status === 'COMPLETED') return;
      if (!ALLOWED_TRANSITIONS[status].includes(body.status)) throw new HttpError(409, `Transition ${status} → ${body.status} not allowed`);
      await db.query(`update work_orders set status = $2, updated_at = $3 where id = $1`, [id, body.status, requireNumber(body.changedAt, 'changedAt')]);
    });
  });

  api.post('/logs', async (c) => {
    const body = await jsonBody<LogEntry>(c);
    const me = c.get('me');
    return idempotent(c, async (db) => {
      if (body.userId !== me.id) throw new HttpError(403, 'Not your entry');
      const orderId = requireId(body.workOrderId, 'workOrderId');
      if (!(await db.query(`select 1 from work_orders where id = $1`, [orderId])).length) throw new HttpError(404, 'Work order not found');
      if (!(await inCrew(db, orderId, me.id))) throw new HttpError(403, 'Not in this crew');
      if (!['QUANTITY', 'NOTE', 'ISSUE'].includes(body.kind)) throw new HttpError(400, 'kind invalid');
      let quantity: number | null = null;
      let text: string | null = null;
      if (body.kind === 'QUANTITY') {
        quantity = requireNumber(body.quantity, 'quantity');
        if (quantity === 0 || Math.abs(quantity) > 100_000) throw new HttpError(400, 'quantity out of range');
        // A correction (negative) keeps the mistaken entry and says why; nothing is ever erased.
        if (quantity < 0) text = requireString(body.text, 'text', 500).trim() || null;
        if (quantity < 0 && !text) throw new HttpError(400, 'A correction needs a reason');
        const updated = await db.query(
          `update work_orders set done_qty = round((done_qty + $2)::numeric, 2), updated_at = $3 where id = $1 and done_qty + $2 >= 0 returning id`,
          [orderId, quantity, Date.now()],
        );
        if (!updated.length) throw new HttpError(409, 'QUANTITY_BELOW_ZERO');
      } else {
        text = requireString(body.text, 'text', 2000);
      }
      await db.query(
        `insert into logs (id, user_id, work_order_id, kind, quantity, text, created_at) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do nothing`,
        [requireId(body.id, 'id'), me.id, orderId, body.kind, quantity, text, requireNumber(body.createdAt, 'createdAt')],
      );
    });
  });

  api.post('/photos', async (c) => {
    const form = await c.req.parseBody();
    const metaRaw = form['meta'];
    const file = form['file'];
    if (typeof metaRaw !== 'string' || !(file instanceof File)) throw new HttpError(400, 'meta and file required');
    if (file.size > config.maxPhotoBytes) throw new HttpError(413, 'File too large');
    let meta: PhotoMeta;
    try {
      meta = JSON.parse(metaRaw) as PhotoMeta;
    } catch {
      throw new HttpError(400, 'meta must be JSON');
    }
    const me = c.get('me');
    if (meta.userId !== me.id) throw new HttpError(403, 'Not your photo');
    if (!meta.privacyConfirmed) throw new HttpError(400, 'Privacy confirmation missing');
    if (!PHOTO_CATEGORIES.includes(meta.category)) throw new HttpError(400, 'category invalid');
    const photoId = requireId(meta.id, 'id');
    const orderId = requireId(meta.workOrderId, 'workOrderId');
    const bytes = new Uint8Array(await file.arrayBuffer());
    // The device re-encodes every photo to JPEG (which drops EXIF); anything else is refused.
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new HttpError(415, 'JPEG required');
    const order = (await c.get('db').query(`select project_id from work_orders where id = $1`, [orderId]))[0];
    if (!order) throw new HttpError(404, 'Work order not found');
    if (!(await inCrew(c.get('db'), orderId, me.id))) throw new HttpError(403, 'Not in this crew');
    const projectId = String(order['project_id']);
    const key = `${projectId}/${orderId}/${photoId}.jpg`;
    // Upload first (idempotent by key), then record; a retry after a failed insert overwrites the same object.
    await photos.put(key, bytes, 'image/jpeg');
    return idempotent(c, async (db) => {
      await db.query(
        `insert into photos (id, user_id, work_order_id, project_id, category, caption, width, height, created_at, privacy_confirmed, mask_count, storage_key, size_bytes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $12) on conflict (id) do nothing`,
        [
          photoId,
          me.id,
          orderId,
          projectId,
          meta.category,
          optionalString(meta.caption, 280),
          Math.round(requireNumber(meta.width, 'width')),
          Math.round(requireNumber(meta.height, 'height')),
          requireNumber(meta.createdAt, 'createdAt'),
          Math.max(0, Math.round(Number(meta.maskCount) || 0)),
          key,
          bytes.length,
        ],
      );
    });
  });

  api.put('/daily-summaries/:id', workerOnly, async (c) => {
    const body = await jsonBody<DailySummary>(c);
    const me = c.get('me');
    return idempotent(c, async (db) => {
      const date = requireDate(body.date, 'date');
      const id = `sum-${me.id}-${date}`;
      if (body.userId !== me.id || c.req.param('id') !== id) throw new HttpError(403, 'Not your summary');
      if (!Array.isArray(body.lines) || !Array.isArray(body.corrections)) throw new HttpError(400, 'lines and corrections required');
      const existing = (await db.query(`select status from daily_summaries where id = $1 for update`, [id]))[0];
      if (existing && existing['status'] === 'APPROVED') throw new HttpError(409, 'Summary already approved');
      // Arrival, departure and hours come from the server's own time records of that day, from every device,
      // never from the numbers in the report: a phone that missed another phone's taps cannot under-report.
      const entries = (await db.query(`select * from time_entries where user_id = $1 and date = $2`, [me.id, date])).map(toTimeEntry);
      const shifts = entries.filter((e) => e.kind === 'SHIFT');
      if (shifts.some((s) => s.endedAt === null)) throw new HttpError(409, 'A shift of that day is still open');
      const now = Date.now();
      const total = (list: readonly TimeEntry[]): number => list.reduce((sum, e) => sum + minutesBetween(e.startedAt, e.endedAt ?? now), 0);
      const segments = entries.filter((e) => e.kind === 'ORDER');
      const lines = (body.lines as readonly Record<string, unknown>[]).map((l) => ({
        ...l,
        minutes: total(segments.filter((e) => e.workOrderId === l['workOrderId'])),
      }));
      const siteName = await shiftSiteNames(db, shifts.sort((a, b) => a.startedAt - b.startedAt));
      await db.query(
        `insert into daily_summaries (id, user_id, date, arrival_at, departure_at, shift_minutes, order_minutes, lines, orders_worked,
           issues_reported, photos_taken, declared_end, corrections, comment, status, submitted_at, reviewed_at, reviewer_name, reviewer_note, site_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9::text::jsonb, $10, $11, $12, $13::text::jsonb, $14, 'SUBMITTED', $15, null, null, null, $16)
         on conflict (id) do update set arrival_at = excluded.arrival_at, departure_at = excluded.departure_at, site_name = excluded.site_name,
           shift_minutes = excluded.shift_minutes, order_minutes = excluded.order_minutes, lines = excluded.lines,
           orders_worked = excluded.orders_worked, issues_reported = excluded.issues_reported, photos_taken = excluded.photos_taken,
           declared_end = excluded.declared_end, corrections = excluded.corrections, comment = excluded.comment,
           status = 'SUBMITTED', submitted_at = excluded.submitted_at, reviewed_at = null, reviewer_name = null, reviewer_note = null`,
        [
          id,
          me.id,
          date,
          shifts.length ? Math.min(...shifts.map((s) => s.startedAt)) : null,
          shifts.length ? Math.max(...shifts.map((s) => s.endedAt ?? 0)) : null,
          total(shifts),
          total(segments),
          JSON.stringify(lines).slice(0, 200_000),
          JSON.stringify(Array.isArray(body.ordersWorked) ? body.ordersWorked : []),
          Math.round(Number(body.issuesReported) || 0),
          Math.round(Number(body.photosTaken) || 0),
          shifts.some((s) => s.endSource === 'DECLARED'),
          JSON.stringify(body.corrections).slice(0, 20_000),
          (typeof body.comment === 'string' ? body.comment : '').slice(0, 2000),
          body.submittedAt === null ? Date.now() : requireNumber(body.submittedAt, 'submittedAt'),
          siteName,
        ],
      );
    });
  });

  // ---- manager
  api.get('/manager/directory', deskOnly, async (c) => {
    const db = c.get('db');
    const scope = await scopeOf(db, c.get('me'));
    const [projects, sites, users, open] = await Promise.all([
      db.query(`select * from projects where active order by code`),
      db.query(`${SITE_SELECT} where s.active and p.active order by p.code, s.name`),
      db.query(`select * from users where role = 'WORKER' and active order by display_name`),
      db.query(
        `select c.user_id, count(*)::int as n from work_order_crew c join work_orders o on o.id = c.order_id
         where o.published and o.status = any($1::text[]) group by c.user_id`,
        [[...OPEN_STATUSES]],
      ),
    ]);
    const openBy = new Map(open.map((r) => [String(r['user_id']), Number(r['n'])]));
    const res: ManagerDirectoryResponse = {
      projects: projects.map(toProject).filter((p) => projectInScope(scope, p.id)),
      sites: sites.map(toSite).filter((s) => siteInScope(scope, s.id)),
      workers: users.map((r) => {
        const u = toUser(r);
        return { user: publicUser(u), openOrders: openBy.get(u.id) ?? 0 };
      }),
      serverTime: Date.now(),
    };
    return c.json(res);
  });

  api.put('/manager/work-orders/:id', deskOnly, async (c) => {
    const body = await jsonBody<WorkOrderUpsert>(c);
    const id = requireId(c.req.param('id'), 'id');
    const me = c.get('me');
    return idempotent(c, async (db) => upsertOrder(db, me, id, body, await scopeOf(db, me)));
  });

  // Tiny and frequent: the overview asks this every few seconds and reloads only when it moved.
  api.get('/manager/changes', deskOnly, async (c) => {
    const row = (await c.get('db').query(`select changed_at from change_marker where id = 1`))[0];
    return c.json({ changedAt: row ? Number(row['changed_at']) : 0 });
  });

  api.get('/manager/overview', deskOnly, async (c) => {
    const date = requireDate(c.req.query('date') ?? today(), 'date');
    const db = c.get('db');
    return c.json(await overview(db, date, await scopeOf(db, c.get('me'))));
  });

  api.get('/manager/hours', deskOnly, async (c) => {
    const month = requireMonth(c.req.query('month') ?? today().slice(0, 7));
    const db = c.get('db');
    const scope = await scopeOf(db, c.get('me'));
    if (scope.all) return c.json(await hours(db, month, null));
    // A manager or foreman keeps the hours of the people on their orders' crews and of anyone who logged time on them.
    const { from, to } = monthWindow(month);
    const siteIds = [...scope.siteIds];
    const rows = siteIds.length
      ? await db.query(
          `select c.user_id from work_order_crew c join work_orders o on o.id = c.order_id where o.site_id = any($1::text[])
           union select t.user_id from time_entries t join work_orders o on o.id = t.work_order_id where o.site_id = any($1::text[]) and t.date between $2 and $3`,
          [siteIds, from, to],
        )
      : [];
    return c.json(await hours(db, month, [...new Set(rows.map((r) => String(r['user_id'])))]));
  });

  api.get('/manager/projects', deskOnly, async (c) => {
    const db = c.get('db');
    return c.json(await projectsList(db, await scopeOf(db, c.get('me'))));
  });

  api.post('/manager/projects', adminOnly, async (c) => {
    const body = await jsonBody<ProjectCreate>(c);
    const name = requireString(body.name, 'name', 120).trim();
    const db = c.get('db');
    // The number is issued here unless the administrator typed one.
    let code: string;
    if (body.code && String(body.code).trim()) {
      code = requireCode(body.code);
    } else {
      const year = new Date().getFullYear();
      const counter = await db.query<{ last: number }>(
        `insert into project_counters (year, last) values ($1, 1) on conflict (year) do update set last = project_counters.last + 1 returning last`,
        [year],
      );
      code = projectNumber(year, Number(counter[0]?.last ?? 1));
    }
    const rows = await db
      .query(`insert into projects (id, code, name, active, created_at) values ($1, $2, $3, true, $4) on conflict (code) do nothing returning *`, [
        `p-${randomUUID()}`,
        code,
        name,
        Date.now(),
      ]);
    if (!rows[0]) throw new HttpError(409, 'CODE_TAKEN');
    return c.json(toProject(rows[0]), 201);
  });

  api.post('/manager/sites', adminOnly, async (c) => {
    const body = await jsonBody<SiteCreate>(c);
    const projectId = requireId(body.projectId, 'projectId');
    const typed = body.code && String(body.code).trim() ? requireCode(body.code) : null;
    const name = requireString(body.name, 'name', 120).trim();
    const city = optionalString(body.city, 80) ?? '';
    const db = c.get('db');
    const id = `s-${randomUUID()}`;
    let code = typed ?? '';
    await db.tx(async (tx) => {
      const project = await tx.query(`select id from projects where id = $1 and active for update`, [projectId]);
      if (!project[0]) throw new HttpError(404, 'Project not found');
      // Objects are numbered within their project (O-1, O-2 â€¦) unless the administrator typed a code.
      if (!typed) {
        const n = Number((await tx.query(`select count(*)::int as n from sites where project_id = $1`, [projectId]))[0]?.['n'] ?? 0);
        code = `O-${n + 1}`;
      }
      const taken = await tx.query(`select 1 from sites where project_id = $1 and code = $2 and active`, [projectId, code]);
      if (taken[0]) throw new HttpError(409, 'CODE_TAKEN');
      await tx.query(`insert into sites (id, project_id, code, name, city, active, created_at) values ($1, $2, $3, $4, $5, true, $6)`, [
        id,
        projectId,
        code,
        name,
        city,
        Date.now(),
      ]);
    });
    const rows = await db.query(`${SITE_SELECT} where s.id = $1`, [id]);
    return c.json(toSite(rows[0] ?? {}), 201);
  });

  api.get('/manager/work-orders/:id', deskOnly, async (c) => {
    const id = requireId(c.req.param('id'), 'id');
    const db = c.get('db');
    const [order] = await loadOrders(db, `where o.id = $1`, [id]);
    if (!order) throw new HttpError(404, 'Work order not found');
    if (!siteInScope(await scopeOf(db, c.get('me')), order.siteId)) throw new HttpError(403, 'OUT_OF_SCOPE');
    const [entries, logs, photoRows, users, summaries] = await Promise.all([
      db.query(`select * from time_entries where work_order_id = $1 order by started_at desc`, [id]),
      db.query(`select * from logs where work_order_id = $1 order by created_at desc`, [id]),
      db.query(`select * from photos where work_order_id = $1 order by created_at`, [id]),
      db.query(`select id, display_name from users`),
      db.query(
        `select * from daily_summaries where ($2::text is not null and orders_worked @> jsonb_build_array($2::text))
         or exists (select 1 from jsonb_array_elements(lines) l where l->>'workOrderId' = $1)
         order by date desc, submitted_at desc nulls last limit 60`,
        [id, order.code],
      ),
    ]);
    const names = new Map(users.map((u) => [String(u['id']), String(u['display_name'])]));
    const timeEntries = entries.map(toTimeEntry);
    const res: WorkOrderDetailResponse = {
      order,
      lockedCrewIds: [...new Set(timeEntries.map((e) => e.userId))],
      timeEntries,
      logs: logs.map(toLog),
      photos: await photoViews(photos, photoRows, names),
      summaries: summaries.map(toSummary),
    };
    return c.json(res);
  });

  api.get('/manager/daily-summaries/:id', deskOnly, async (c) => {
    const db = c.get('db');
    const row = (await db.query(`select * from daily_summaries where id = $1`, [c.req.param('id') ?? '']))[0];
    if (!row) throw new HttpError(404, 'Summary not found');
    const summary = toSummary(row);
    if (!(await summaryInScope(db, await scopeOf(db, c.get('me')), summary))) throw new HttpError(403, 'OUT_OF_SCOPE');
    const workerRow = (await db.query(`select * from users where id = $1`, [summary.userId]))[0];
    if (!workerRow) throw new HttpError(404, 'Worker not found');
    const worker = toUser(workerRow);
    const start = new Date(`${summary.date}T00:00:00`).getTime();
    const photoRows = await db.query(`select * from photos where user_id = $1 and created_at >= $2 and created_at < $3 order by created_at`, [
      worker.id,
      start,
      start + DAY_MS,
    ]);
    const res: SummaryDetailResponse = {
      summary,
      worker: publicUser(worker),
      photos: await photoViews(photos, photoRows, new Map([[worker.id, worker.displayName]])),
    };
    return c.json(res);
  });

  api.post('/daily-summaries/:id/review', approverOnly, async (c) => {
    const body = await jsonBody<SummaryReviewRequest>(c);
    if (body.decision !== 'APPROVED' && body.decision !== 'RETURNED') throw new HttpError(400, 'Invalid decision');
    const note = optionalString(body.note, 1000);
    if (body.decision === 'RETURNED' && !note) throw new HttpError(400, 'A returned report needs a note');
    const me = c.get('me');
    await c.get('db').tx(async (db) => {
      const row = (await db.query(`select * from daily_summaries where id = $1 for update`, [c.req.param('id') ?? '']))[0];
      if (!row) throw new HttpError(404, 'Summary not found');
      if (!(await summaryInScope(db, await scopeOf(db, me), toSummary(row)))) throw new HttpError(403, 'OUT_OF_SCOPE');
      if (row['status'] !== 'SUBMITTED') throw new HttpError(409, 'Only a submitted report can be reviewed');
      await db.query(`update daily_summaries set status = $2, reviewed_at = $3, reviewer_name = $4, reviewer_note = $5 where id = $1`, [
        c.req.param('id') ?? '',
        body.decision,
        Date.now(),
        me.displayName,
        note,
      ]);
      await markChanged(db);
    });
    return c.body(null, 204);
  });

  // ---- administrator
  api.get('/admin/users', adminOnly, async (c) => {
    const res: AdminUsersResponse = { users: await adminUsers(c.get('db')) };
    return c.json(res);
  });

  api.post('/admin/users', adminOnly, async (c) => {
    const body = await jsonBody<AdminUserCreate>(c);
    const username = requireString(body.username, 'username', 40).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'INVALID_USERNAME');
    const displayName = requireString(body.displayName, 'displayName', 80).trim();
    const role = requireRole(body.role);
    const password = requirePassword(body.password);
    const id = `u-${randomUUID()}`;
    const rows = await c.get('db').query(
      `insert into users (id, username, display_name, role, crew, password_hash, active, created_at)
       values ($1, $2, $3, $4, $5, $6, true, $7) on conflict (username) do nothing returning id`,
      [id, username, displayName, role, optionalString(body.crew, 40), await hashPassword(password), Date.now()],
    );
    if (!rows[0]) throw new HttpError(409, 'USERNAME_TAKEN');
    return c.json({ id }, 201);
  });

  api.patch('/admin/users/:id', adminOnly, async (c) => {
    const body = await jsonBody<AdminUserUpdate>(c);
    const id = requireId(c.req.param('id'), 'id');
    const me = c.get('me');
    await c.get('db').tx(async (db) => {
      const row = (await db.query(`select * from users where id = $1 for update`, [id]))[0];
      if (!row) throw new HttpError(404, 'User not found');
      const user = toUser(row);
      const role = body.role === undefined ? user.role : requireRole(body.role);
      const active = body.active === undefined ? user.active : body.active === true;
      if (id === me.id && (role !== user.role || !active)) throw new HttpError(409, 'SELF_LOCKOUT');
      if (user.role === 'ADMIN' && user.active && (role !== 'ADMIN' || !active)) {
        const others = await db.query(`select 1 from users where role = 'ADMIN' and active and id <> $1 for update`, [id]);
        if (others.length === 0) throw new HttpError(409, 'LAST_ADMIN');
      }
      if (user.role === 'WORKER' && role !== 'WORKER') {
        const open = await db.query(
          `select 1 from work_order_crew c join work_orders o on o.id = c.order_id where c.user_id = $1 and o.status <> 'COMPLETED' limit 1`,
          [id],
        );
        if (open.length > 0) throw new HttpError(409, 'OPEN_ORDERS');
      }
      const displayName = body.displayName === undefined ? user.displayName : requireString(body.displayName, 'displayName', 80).trim();
      const crew = body.crew === undefined ? (user.crew ?? null) : optionalString(body.crew, 40);
      await db.query(`update users set display_name = $2, role = $3, crew = $4, active = $5 where id = $1`, [id, displayName, role, crew, active]);
      // Leading a project or object belongs to the role: a role change ends those assignments.
      if (role !== 'MANAGER') await db.query(`delete from project_managers where user_id = $1`, [id]);
      if (role !== 'FOREMAN') await db.query(`delete from site_foremen where user_id = $1`, [id]);
    });
    return c.body(null, 204);
  });

  api.post('/admin/users/:id/password', adminOnly, async (c) => {
    const body = await jsonBody<PasswordReset>(c);
    const id = requireId(c.req.param('id'), 'id');
    const rows = await c.get('db').query(`update users set password_hash = $2 where id = $1 returning id`, [id, await hashPassword(requirePassword(body.password))]);
    if (!rows[0]) throw new HttpError(404, 'User not found');
    return c.body(null, 204);
  });

  api.patch('/admin/projects/:id', adminOnly, async (c) => {
    const body = await jsonBody<ProjectUpdate>(c);
    const id = requireId(c.req.param('id'), 'id');
    await c.get('db').tx(async (db) => {
      const row = (await db.query(`select * from projects where id = $1 for update`, [id]))[0];
      if (!row) throw new HttpError(404, 'Project not found');
      const name = body.name === undefined ? String(row['name']) : requireString(body.name, 'name', 120).trim();
      const active = body.active === undefined ? row['active'] === true : body.active === true;
      if (!active && row['active'] === true) {
        const open = await db.query(`select 1 from work_orders where project_id = $1 and status <> 'COMPLETED' limit 1`, [id]);
        if (open.length > 0) throw new HttpError(409, 'OPEN_ORDERS');
      }
      await db.query(`update projects set name = $2, active = $3 where id = $1`, [id, name, active]);
    });
    return c.body(null, 204);
  });

  api.patch('/admin/sites/:id', adminOnly, async (c) => {
    const body = await jsonBody<SiteUpdate>(c);
    const id = requireId(c.req.param('id'), 'id');
    await c.get('db').tx(async (db) => {
      const row = (await db.query(`select * from sites where id = $1 for update`, [id]))[0];
      if (!row) throw new HttpError(404, 'Object not found');
      const name = body.name === undefined ? String(row['name']) : requireString(body.name, 'name', 120).trim();
      const city = body.city === undefined ? String(row['city'] ?? '') : (optionalString(body.city, 80) ?? '');
      const active = body.active === undefined ? row['active'] === true : body.active === true;
      if (!active && row['active'] === true) {
        const open = await db.query(`select 1 from work_orders where site_id = $1 and status <> 'COMPLETED' limit 1`, [id]);
        if (open.length > 0) throw new HttpError(409, 'OPEN_ORDERS');
      }
      await db.query(`update sites set name = $2, city = $3, active = $4 where id = $1`, [id, name, city, active]);
    });
    return c.body(null, 204);
  });

  api.put('/admin/projects/:id/managers', adminOnly, async (c) => {
    const body = await jsonBody<AssignmentUpdate>(c);
    const id = requireId(c.req.param('id'), 'id');
    await c.get('db').tx(async (db) => {
      if (!(await db.query(`select 1 from projects where id = $1 for update`, [id])).length) throw new HttpError(404, 'Project not found');
      const userIds = await requireUsersWithRole(db, body.userIds, 'MANAGER');
      await db.query(`delete from project_managers where project_id = $1`, [id]);
      for (const uid of userIds) await db.query(`insert into project_managers (project_id, user_id) values ($1, $2)`, [id, uid]);
    });
    return c.body(null, 204);
  });

  api.put('/admin/sites/:id/foremen', adminOnly, async (c) => {
    const body = await jsonBody<AssignmentUpdate>(c);
    const id = requireId(c.req.param('id'), 'id');
    await c.get('db').tx(async (db) => {
      if (!(await db.query(`select 1 from sites where id = $1 for update`, [id])).length) throw new HttpError(404, 'Object not found');
      const userIds = await requireUsersWithRole(db, body.userIds, 'FOREMAN');
      await db.query(`delete from site_foremen where site_id = $1`, [id]);
      for (const uid of userIds) await db.query(`insert into site_foremen (site_id, user_id) values ($1, $2)`, [id, uid]);
    });
    return c.body(null, 204);
  });

  app.route('/api/v1', api);
  return app;
}

// ---------- queries ----------

async function upsertOrder(db: Db, me: UserRow, id: string, body: WorkOrderUpsert, scope: Scope): Promise<void> {
  if (body.id !== id) throw new HttpError(400, 'id mismatch');
  const title = requireString(body.title, 'title', 140).trim();
  const siteRow = (await db.query(`${SITE_SELECT} where s.id = $1`, [requireId(body.siteId, 'siteId')]))[0];
  if (!siteRow) throw new HttpError(404, 'Object not found');
  const site = toSite(siteRow);
  if (!siteInScope(scope, site.id)) throw new HttpError(403, 'OUT_OF_SCOPE');
  const existing = (await db.query(`select * from work_orders where id = $1 for update`, [id]))[0];
  // Moving an order needs both ends in scope: nobody takes an order away from someone else's object.
  if (existing && !siteInScope(scope, String(existing['site_id']))) throw new HttpError(403, 'OUT_OF_SCOPE');
  if (!QUANTITY_UNITS.includes(body.unit)) throw new HttpError(400, 'unit invalid');
  const plannedQty = requireNumber(body.plannedQty, 'plannedQty');
  if (plannedQty <= 0) throw new HttpError(400, 'plannedQty must be positive');
  if (!Array.isArray(body.crewIds)) throw new HttpError(400, 'crewIds required');
  const crewIds = [...new Set(body.crewIds.filter(isId))];
  // Newcomers must be active workers; someone already on the crew stays valid after leaving, so the order
  // remains editable (their recorded time keeps them on it).
  const current = existing ? (await db.query(`select user_id from work_order_crew where order_id = $1`, [id])).map((r) => String(r['user_id'])) : [];
  const newcomers = crewIds.filter((uid) => !current.includes(uid));
  const known = await db.query(`select id from users where role = 'WORKER' and active and id = any($1::text[])`, [newcomers]);
  if (known.length !== newcomers.length) throw new HttpError(400, 'Unknown worker in crew');
  if (body.published && crewIds.length === 0) throw new HttpError(400, 'An assigned order needs at least one worker');
  const estimated = body.estimatedMinutes === null ? null : Math.max(0, Math.round(requireNumber(body.estimatedMinutes, 'estimatedMinutes')));
  const materials = (Array.isArray(body.materials) ? body.materials : [])
    .filter((m) => typeof m?.name === 'string' && m.name.trim() !== '')
    .slice(0, 40)
    .map((m) => ({ name: m.name.trim().slice(0, 80), qty: typeof m.qty === 'number' && Number.isFinite(m.qty) ? m.qty : null, unit: m.unit?.trim().slice(0, 12) || null }));
  const date = optionalDate(body.date, 'date');
  const dueDate = optionalDate(body.dueDate, 'dueDate');
  const now = Date.now();

  if (existing) {
    const worked = new Set((await db.query(`select distinct user_id from time_entries where work_order_id = $1`, [id])).map((r) => String(r['user_id'])));
    if ([...worked].some((uid) => !crewIds.includes(uid))) throw new HttpError(409, 'Workers with recorded time cannot be removed');
    if (worked.size > 0 && (existing['site_id'] !== site.id || existing['unit'] !== body.unit || Number(existing['planned_qty']) !== plannedQty)) {
      throw new HttpError(409, 'Object, unit and plan are locked once work has started');
    }
    await db.query(
      `update work_orders set title = $2, description = $3, project_id = $4, site_id = $5, location = $6, published = $7,
         unit = $8, planned_qty = $9, estimated_minutes = $10, materials = $11::text::jsonb, date = $12, due_date = $13, updated_at = $14
       where id = $1`,
      [id, title, (body.description ?? '').trim().slice(0, 4000), site.projectId, site.id, (body.location ?? '').trim().slice(0, 140),
        existing['published'] === true || body.published === true, body.unit, plannedQty, estimated, JSON.stringify(materials), date, dueDate, now],
    );
    await db.query(`delete from work_order_crew where order_id = $1`, [id]);
  } else {
    const year = new Date().getFullYear();
    const counter = await db.query<{ last: number }>(
      `insert into order_counters (year, last) values ($1, 1) on conflict (year) do update set last = order_counters.last + 1 returning last`,
      [year],
    );
    const code = orderNumber(year, Number(counter[0]?.last ?? 1));
    await db.query(
      `insert into work_orders (id, code, title, description, project_id, site_id, location, manager_id, status, published, unit,
         planned_qty, done_qty, estimated_minutes, materials, date, due_date, updated_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'NEW', $9, $10, $11, 0, $12, $13::text::jsonb, $14, $15, $16, $16)`,
      [id, code, title, (body.description ?? '').trim().slice(0, 4000), site.projectId, site.id, (body.location ?? '').trim().slice(0, 140),
        me.id, body.published === true, body.unit, plannedQty, estimated, JSON.stringify(materials), date, dueDate, now],
    );
  }
  for (const uid of crewIds) {
    await db.query(`insert into work_order_crew (order_id, user_id) values ($1, $2) on conflict do nothing`, [id, uid]);
  }
}

async function photoViews(store: PhotoStore, rows: readonly Record<string, unknown>[], names: ReadonlyMap<string, string>): Promise<PhotoView[]> {
  return Promise.all(
    rows.map(async (r) => {
      const { storageKey, ...meta } = toPhoto(r);
      return { ...meta, url: await store.url(storageKey), userName: names.get(meta.userId) ?? '' };
    }),
  );
}

/** One month of working time for the given workers (null: every worker). */
async function hours(db: Db, month: string, userIds: readonly string[] | null): Promise<HoursResponse> {
  const { from, to } = monthWindow(month);
  if (userIds && userIds.length === 0) {
    return { month, from, to, workers: [], shifts: [], segments: [], orders: [], sites: [], summaries: [], serverTime: Date.now() };
  }
  const ids = userIds ? [...userIds] : null;
  const [userRows, entryRows, summaryRows] = await Promise.all([
    ids ? db.query(`select * from users where id = any($1::text[]) order by display_name`, [ids]) : db.query(`select * from users where role = 'WORKER' order by display_name`),
    db.query(
      `select * from time_entries where date between $1 and $2 and ($3::text[] is null or user_id = any($3::text[])) order by started_at`,
      [from, to, ids],
    ),
    db.query(
      `select id, user_id, date, status from daily_summaries where date like $1 and ($2::text[] is null or user_id = any($2::text[]))`,
      [`${month}-%`, ids],
    ),
  ]);
  const entries = entryRows.map(toTimeEntry);
  const shifts = entries.filter((e) => e.kind === 'SHIFT');
  const segments = entries.filter((e) => e.kind === 'ORDER' && monthOf(e.date) === month);
  // Inactive workers stay in the record for the months they worked.
  const worked = new Set(shifts.filter((e) => monthOf(e.date) === month).map((e) => e.userId));
  const workers = userRows.map(toUser).filter((u) => u.active !== false || worked.has(u.id));
  const orderIds = [...new Set(segments.map((e) => e.workOrderId).filter((id): id is string => !!id))];
  const orderRows = orderIds.length ? await db.query(`select id, code, title, site_id from work_orders where id = any($1::text[])`, [orderIds]) : [];
  const siteIds = [...new Set(orderRows.map((r) => String(r['site_id'])))];
  const siteRows = siteIds.length ? await db.query(`${SITE_SELECT} where s.id = any($1::text[])`, [siteIds]) : [];
  return {
    month,
    from,
    to,
    workers: workers.map(publicUser),
    shifts,
    segments,
    orders: orderRows.map((r) => ({ id: String(r['id']), code: r['code'] == null ? null : String(r['code']), title: String(r['title']), siteId: String(r['site_id']) })),
    // Names for the orders a worker logged, also on objects outside the reader's scope: the record is the worker's whole month.
    sites: siteRows.map(toSite),
    summaries: summaryRows.map((r) => ({ id: String(r['id']), userId: String(r['user_id']), date: String(r['date']) as IsoDate, status: String(r['status']) as DailySummary['status'] })),
    serverTime: Date.now(),
  };
}

async function overview(db: Db, date: IsoDate, scope: Scope): Promise<ManagerOverviewResponse> {
  const now = Date.now();
  const recent = now - 30 * DAY_MS;
  const [projectRows, siteRows, allWorkerRows, allOrders, allDayEntriesRaw, allSummaries] = await Promise.all([
    db.query(`select * from projects where active order by code`),
    db.query(`${SITE_SELECT} where s.active order by p.code, s.name`),
    db.query(`select * from users where role = 'WORKER' and active order by display_name`),
    loadOrders(db, `where o.status <> 'COMPLETED' or o.updated_at > $1 or exists (select 1 from time_entries t where t.work_order_id = o.id and t.date = $2) order by o.created_at`, [recent, date]),
    db.query(`select * from time_entries where date = $1`, [date]),
    db.query(`select * from daily_summaries where date = $1`, [date]),
  ]);
  const projects = projectRows.filter((r) => projectInScope(scope, String(r['id'])));
  const sites = siteRows.filter((r) => siteInScope(scope, String(r['id'])));
  const orders = allOrders.filter((o) => siteInScope(scope, o.siteId));
  // The administrator sees every worker. A manager or foreman sees the workers on their orders' crews and anyone
  // who logged time on those orders that day; the rest of the company is not their business.
  const inScopeOrderIds = new Set(orders.map((o) => o.id));
  const visibleWorkers = new Set<string>();
  for (const o of orders) for (const m of o.crew) visibleWorkers.add(m.id);
  for (const r of allDayEntriesRaw) {
    const onOrder = inScopeOrderIds.has(String(r['work_order_id']));
    const onSite = r['kind'] === 'SHIFT' && r['site_id'] != null && siteInScope(scope, String(r['site_id']));
    if (onOrder || onSite) visibleWorkers.add(String(r['user_id']));
  }
  const userRows = scope.all ? allWorkerRows : allWorkerRows.filter((r) => visibleWorkers.has(String(r['id'])));
  const dayEntriesRaw = scope.all ? allDayEntriesRaw : allDayEntriesRaw.filter((r) => visibleWorkers.has(String(r['user_id'])));
  const summaries = scope.all ? allSummaries : allSummaries.filter((r) => visibleWorkers.has(String(r['user_id'])));
  const orderIds = orders.map((o) => o.id);
  const [orderEntriesRaw, photoCounts, issueCounts] = orderIds.length
    ? await Promise.all([
        db.query(`select * from time_entries where work_order_id = any($1::text[])`, [orderIds]),
        db.query(`select work_order_id, count(*)::int as n from photos where work_order_id = any($1::text[]) group by work_order_id`, [orderIds]),
        db.query(`select work_order_id, count(*)::int as n from logs where kind = 'ISSUE' and work_order_id = any($1::text[]) group by work_order_id`, [orderIds]),
      ])
    : [[], [], []];
  const dayEntries = dayEntriesRaw.map(toTimeEntry);
  const orderEntries = orderEntriesRaw.map(toTimeEntry);
  const siteList = sites.map(toSite);
  const siteById = new Map(siteList.map((s) => [s.id, s]));
  const allSiteById = new Map(siteRows.map(toSite).map((s) => [s.id, s]));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const photosBy = new Map(photoCounts.map((r) => [String(r['work_order_id']), Number(r['n'])]));
  const issuesBy = new Map(issueCounts.map((r) => [String(r['work_order_id']), Number(r['n'])]));
  const summaryList = summaries.map(toSummary);

  const workers: WorkerOverview[] = userRows.map((r) => {
    const u = toUser(r);
    const shifts = dayEntries.filter((e) => e.userId === u.id && e.kind === 'SHIFT').sort((a, b) => a.startedAt - b.startedAt);
    const open = shifts.find((s) => s.endedAt === null) ?? null;
    const segs = dayEntries.filter((e) => e.userId === u.id && e.kind === 'ORDER').sort((a, b) => b.startedAt - a.startedAt);
    const activeSeg = segs.find((s) => s.endedAt === null) ?? null;
    const recentOrder =
      orderById.get(activeSeg?.workOrderId ?? segs[0]?.workOrderId ?? '') ?? orders.find((o) => o.published && o.crew.some((c) => c.id === u.id)) ?? null;
    const summary = summaryList.find((s) => s.userId === u.id) ?? null;
    // The object chosen at ZAČNI DELO wins; without one, the object of the order they worked on.
    const chosenSiteId = (open ?? shifts.at(-1))?.siteId ?? null;
    const chosenSite = chosenSiteId ? (siteById.get(chosenSiteId) ?? allSiteById.get(chosenSiteId) ?? null) : null;
    return {
      user: publicUser(u),
      presence: open ? 'WORKING' : shifts.length > 0 ? 'FINISHED' : 'NOT_STARTED',
      site: chosenSite ?? (recentOrder ? (siteById.get(recentOrder.siteId) ?? null) : null),
      activeOrderCode: activeSeg ? (orderById.get(activeSeg.workOrderId ?? '')?.code ?? null) : null,
      shiftStartedAt: shifts[0]?.startedAt ?? null,
      shiftEndedAt: open ? null : shifts.reduce<number | null>((m, s) => (s.endedAt != null && (m === null || s.endedAt > m) ? s.endedAt : m), null),
      minutesToday: shifts.reduce((sum, s) => sum + minutesBetween(s.startedAt, s.endedAt ?? now), 0),
      summaryId: summary?.id ?? null,
      summaryStatus: summary?.status ?? null,
    };
  });

  const orderRows: OrderOverview[] = orders.map((o) => {
    const segs = orderEntries.filter((e) => e.kind === 'ORDER' && e.workOrderId === o.id);
    return {
      order: o,
      minutesToday: segs.filter((e) => e.date === date).reduce((s, e) => s + minutesBetween(e.startedAt, e.endedAt ?? now), 0),
      minutesTotal: segs.reduce((s, e) => s + minutesBetween(e.startedAt, e.endedAt ?? now), 0),
      photoCount: photosBy.get(o.id) ?? 0,
      openIssues: o.status === 'ISSUE' ? Math.max(1, issuesBy.get(o.id) ?? 0) : 0,
    };
  });

  return { date, projects: projects.map(toProject), sites: siteList, workers, orders: orderRows, summaries: summaryList, serverTime: now };
}

async function projectsList(db: Db, scope: Scope): Promise<ManagerProjectsResponse> {
  const now = Date.now();
  const [projectRows, siteRows, allOrders, minutes, issues, managerRows, foremanRows] = await Promise.all([
    db.query(`select * from projects where active order by code`),
    db.query(`${SITE_SELECT} where s.active order by p.code, s.name`),
    loadOrders(db, `order by o.created_at desc`),
    db.query(`select work_order_id, started_at, ended_at from time_entries where kind = 'ORDER'`),
    db.query(`select work_order_id, count(*)::int as n from logs where kind = 'ISSUE' group by work_order_id`),
    db.query(`select pm.project_id, u.id, u.display_name from project_managers pm join users u on u.id = pm.user_id where u.active order by u.display_name`),
    db.query(`select sf.site_id, u.id, u.display_name from site_foremen sf join users u on u.id = sf.user_id where u.active order by u.display_name`),
  ]);
  const projects = projectRows.filter((r) => projectInScope(scope, String(r['id'])));
  const sites = siteRows.filter((r) => siteInScope(scope, String(r['id'])));
  const orders = allOrders.filter((o) => siteInScope(scope, o.siteId));
  const member = (r: Record<string, unknown>): CrewMember => ({ id: String(r['id']), displayName: String(r['display_name']) });
  const managersBy = new Map<string, CrewMember[]>();
  for (const r of managerRows) managersBy.set(String(r['project_id']), [...(managersBy.get(String(r['project_id'])) ?? []), member(r)]);
  const foremenBy = new Map<string, CrewMember[]>();
  for (const r of foremanRows) foremenBy.set(String(r['site_id']), [...(foremenBy.get(String(r['site_id'])) ?? []), member(r)]);
  const minutesBy = new Map<string, number>();
  for (const r of minutes) {
    const id = String(r['work_order_id']);
    minutesBy.set(id, (minutesBy.get(id) ?? 0) + minutesBetween(Number(r['started_at']), r['ended_at'] == null ? now : Number(r['ended_at'])));
  }
  const issuesBy = new Map(issues.map((r) => [String(r['work_order_id']), Number(r['n'])]));
  const siteList = sites.map(toSite);
  return {
    projects: projects.map((r) => {
      const project = toProject(r);
      const projectSites = siteList.filter((s) => s.projectId === project.id);
      return {
        project,
        sites: projectSites,
        managers: managersBy.get(project.id) ?? [],
        foremen: Object.fromEntries(projectSites.map((s) => [s.id, foremenBy.get(s.id) ?? []])),
        orders: orders
          .filter((o) => o.projectId === project.id)
          .map((o) => ({
            id: o.id,
            code: o.code,
            title: o.title,
            siteId: o.siteId,
            status: o.status,
            published: o.published,
            crewNames: o.crew.map((c) => c.displayName),
            doneQty: o.doneQty,
            plannedQty: o.plannedQty,
            unit: o.unit,
            minutesTotal: minutesBy.get(o.id) ?? 0,
            dueDate: o.dueDate,
            openIssues: o.status === 'ISSUE' ? Math.max(1, issuesBy.get(o.id) ?? 0) : 0,
          })),
      };
    }),
    serverTime: now,
  };
}

export type { SqlParam };
