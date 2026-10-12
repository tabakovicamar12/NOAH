import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type {
  ConsentRequest,
  LoginRequest,
  ManagerDirectoryResponse,
  ManagerOverviewResponse,
  ManagerProjectsResponse,
  OrderOverview,
  PhotoView,
  ProjectCreate,
  SiteCreate,
  SummaryDetailResponse,
  SummaryReviewRequest,
  WorkOrderDetailResponse,
  WorkOrderStatusRequest,
  WorkOrderUpsert,
  WorkerOverview,
} from '../src/app/core/models/api.models';
import {
  PHOTO_CATEGORIES,
  QUANTITY_UNITS,
  type DailySummary,
  type IsoDate,
  type LogEntry,
  type PhotoMeta,
  type TimeEntry,
  type WorkOrderStatus,
} from '../src/app/core/models/domain.models';
import { LoginThrottle, issueToken, readFileKey, readToken, verifyPassword } from './auth';
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
  });
  return c.body(null, 204);
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
    if (user.role !== body.role) throw new HttpError(403, 'ROLE_MISMATCH');
    throttle.clear(keys);
    const { token, expiresAt } = await issueToken(config, { sub: user.id, role: user.role });
    return c.json({ token, expiresAt, user: publicUser(user) });
  });

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
  const managerOnly = async (c: Context<Env>, next: () => Promise<void>): Promise<void> => {
    if (c.get('me').role !== 'MANAGER') throw new HttpError(403, 'Forbidden for this role');
    await next();
  };
  const projectAdmin = async (c: Context<Env>, next: () => Promise<void>): Promise<void> => {
    const me = c.get('me');
    if (me.role !== 'MANAGER' || !me.canManageProjects) throw new HttpError(403, 'Forbidden for this role');
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
       and (o.status <> 'COMPLETED' or o.updated_at > $2) order by o.code`,
      [me.id, Date.now() - 14 * DAY_MS],
    );
    return c.json({ orders, serverTime: Date.now() });
  });

  api.get('/worker/daily-summary', workerOnly, async (c) => {
    const date = requireDate(c.req.query('date'), 'date');
    const rows = await c.get('db').query(`select * from daily_summaries where id = $1`, [`sum-${c.get('me').id}-${date}`]);
    return c.json(rows[0] ? toSummary(rows[0]) : null);
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
      const existing = (await db.query(`select * from time_entries where id = $1 for update`, [body.id]))[0];
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
        `insert into time_entries (id, user_id, kind, work_order_id, date, started_at, ended_at, end_source, end_note, received_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
        ],
      );
    });
  });

  api.post('/work-orders/:id/status', async (c) => {
    const body = await jsonBody<WorkOrderStatusRequest>(c);
    const me = c.get('me');
    const id = requireId(c.req.param('id'), 'id');
    return idempotent(c, async (db) => {
      const current = (await db.query(`select status from work_orders where id = $1 for update`, [id]))[0];
      if (!current) throw new HttpError(404, 'Work order not found');
      const inCrew = (await db.query(`select 1 from work_order_crew where order_id = $1 and user_id = $2`, [id, me.id])).length > 0;
      if (!inCrew && me.role !== 'MANAGER') throw new HttpError(403, 'Not in this crew');
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
      if (!['QUANTITY', 'NOTE', 'ISSUE'].includes(body.kind)) throw new HttpError(400, 'kind invalid');
      let quantity: number | null = null;
      let text: string | null = null;
      if (body.kind === 'QUANTITY') {
        quantity = requireNumber(body.quantity, 'quantity');
        if (quantity <= 0 || quantity > 100_000) throw new HttpError(400, 'quantity out of range');
        await db.query(`update work_orders set done_qty = round((done_qty + $2)::numeric, 2), updated_at = $3 where id = $1`, [orderId, quantity, Date.now()]);
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
      await db.query(
        `insert into daily_summaries (id, user_id, date, arrival_at, departure_at, shift_minutes, order_minutes, lines, orders_worked,
           issues_reported, photos_taken, declared_end, corrections, comment, status, submitted_at, reviewed_at, reviewer_name, reviewer_note)
         values ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9::text::jsonb, $10, $11, $12, $13::text::jsonb, $14, 'SUBMITTED', $15, null, null, null)
         on conflict (id) do update set arrival_at = excluded.arrival_at, departure_at = excluded.departure_at,
           shift_minutes = excluded.shift_minutes, order_minutes = excluded.order_minutes, lines = excluded.lines,
           orders_worked = excluded.orders_worked, issues_reported = excluded.issues_reported, photos_taken = excluded.photos_taken,
           declared_end = excluded.declared_end, corrections = excluded.corrections, comment = excluded.comment,
           status = 'SUBMITTED', submitted_at = excluded.submitted_at, reviewed_at = null, reviewer_name = null, reviewer_note = null`,
        [
          id,
          me.id,
          date,
          body.arrivalAt === null ? null : requireNumber(body.arrivalAt, 'arrivalAt'),
          body.departureAt === null ? null : requireNumber(body.departureAt, 'departureAt'),
          Math.round(requireNumber(body.shiftMinutes, 'shiftMinutes')),
          Math.round(requireNumber(body.orderMinutes, 'orderMinutes')),
          JSON.stringify(body.lines).slice(0, 200_000),
          JSON.stringify(Array.isArray(body.ordersWorked) ? body.ordersWorked : []),
          Math.round(Number(body.issuesReported) || 0),
          Math.round(Number(body.photosTaken) || 0),
          body.declaredEnd === true,
          JSON.stringify(body.corrections).slice(0, 20_000),
          (typeof body.comment === 'string' ? body.comment : '').slice(0, 2000),
          body.submittedAt === null ? Date.now() : requireNumber(body.submittedAt, 'submittedAt'),
        ],
      );
    });
  });

  // ---- manager
  api.get('/manager/directory', managerOnly, async (c) => {
    const db = c.get('db');
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
      projects: projects.map(toProject),
      sites: sites.map(toSite),
      workers: users.map((r) => {
        const u = toUser(r);
        return { user: publicUser(u), openOrders: openBy.get(u.id) ?? 0 };
      }),
      serverTime: Date.now(),
    };
    return c.json(res);
  });

  api.put('/manager/work-orders/:id', managerOnly, async (c) => {
    const body = await jsonBody<WorkOrderUpsert>(c);
    const id = requireId(c.req.param('id'), 'id');
    const me = c.get('me');
    return idempotent(c, (db) => upsertOrder(db, me, id, body));
  });

  api.get('/manager/overview', managerOnly, async (c) => {
    const date = requireDate(c.req.query('date') ?? today(), 'date');
    return c.json(await overview(c.get('db'), date));
  });

  api.get('/manager/projects', managerOnly, async (c) => c.json(await projectsList(c.get('db'))));

  api.post('/manager/projects', projectAdmin, async (c) => {
    const body = await jsonBody<ProjectCreate>(c);
    const code = requireCode(body.code);
    const name = requireString(body.name, 'name', 120).trim();
    const rows = await c
      .get('db')
      .query(`insert into projects (id, code, name, active, created_at) values ($1, $2, $3, true, $4) on conflict (code) do nothing returning *`, [
        `p-${randomUUID()}`,
        code,
        name,
        Date.now(),
      ]);
    if (!rows[0]) throw new HttpError(409, 'CODE_TAKEN');
    return c.json(toProject(rows[0]), 201);
  });

  api.post('/manager/sites', projectAdmin, async (c) => {
    const body = await jsonBody<SiteCreate>(c);
    const projectId = requireId(body.projectId, 'projectId');
    const code = requireCode(body.code);
    const name = requireString(body.name, 'name', 120).trim();
    const city = optionalString(body.city, 80) ?? '';
    const db = c.get('db');
    const id = `s-${randomUUID()}`;
    await db.tx(async (tx) => {
      const project = await tx.query(`select id from projects where id = $1 and active for update`, [projectId]);
      if (!project[0]) throw new HttpError(404, 'Project not found');
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

  api.get('/manager/work-orders/:id', managerOnly, async (c) => {
    const id = requireId(c.req.param('id'), 'id');
    const db = c.get('db');
    const [order] = await loadOrders(db, `where o.id = $1`, [id]);
    if (!order) throw new HttpError(404, 'Work order not found');
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

  api.get('/manager/daily-summaries/:id', managerOnly, async (c) => {
    const db = c.get('db');
    const row = (await db.query(`select * from daily_summaries where id = $1`, [c.req.param('id') ?? '']))[0];
    if (!row) throw new HttpError(404, 'Summary not found');
    const summary = toSummary(row);
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

  api.post('/daily-summaries/:id/review', managerOnly, async (c) => {
    const body = await jsonBody<SummaryReviewRequest>(c);
    if (body.decision !== 'APPROVED' && body.decision !== 'RETURNED') throw new HttpError(400, 'Invalid decision');
    const note = optionalString(body.note, 1000);
    if (body.decision === 'RETURNED' && !note) throw new HttpError(400, 'A returned report needs a note');
    const me = c.get('me');
    await c.get('db').tx(async (db) => {
      const row = (await db.query(`select status from daily_summaries where id = $1 for update`, [c.req.param('id') ?? '']))[0];
      if (!row) throw new HttpError(404, 'Summary not found');
      if (row['status'] !== 'SUBMITTED') throw new HttpError(409, 'Only a submitted report can be reviewed');
      await db.query(`update daily_summaries set status = $2, reviewed_at = $3, reviewer_name = $4, reviewer_note = $5 where id = $1`, [
        c.req.param('id') ?? '',
        body.decision,
        Date.now(),
        me.displayName,
        note,
      ]);
    });
    return c.body(null, 204);
  });

  app.route('/api/v1', api);
  return app;
}

// ---------- queries ----------

async function upsertOrder(db: Db, me: UserRow, id: string, body: WorkOrderUpsert): Promise<void> {
  if (body.id !== id) throw new HttpError(400, 'id mismatch');
  const title = requireString(body.title, 'title', 140).trim();
  const siteRow = (await db.query(`${SITE_SELECT} where s.id = $1`, [requireId(body.siteId, 'siteId')]))[0];
  if (!siteRow) throw new HttpError(404, 'Object not found');
  const site = toSite(siteRow);
  if (!QUANTITY_UNITS.includes(body.unit)) throw new HttpError(400, 'unit invalid');
  const plannedQty = requireNumber(body.plannedQty, 'plannedQty');
  if (plannedQty <= 0) throw new HttpError(400, 'plannedQty must be positive');
  if (!Array.isArray(body.crewIds)) throw new HttpError(400, 'crewIds required');
  const crewIds = [...new Set(body.crewIds.filter(isId))];
  const known = await db.query(`select id from users where role = 'WORKER' and active and id = any($1::text[])`, [crewIds]);
  if (known.length !== crewIds.length) throw new HttpError(400, 'Unknown worker in crew');
  if (body.published && crewIds.length === 0) throw new HttpError(400, 'An assigned order needs at least one worker');
  const estimated = body.estimatedMinutes === null ? null : Math.max(0, Math.round(requireNumber(body.estimatedMinutes, 'estimatedMinutes')));
  const materials = (Array.isArray(body.materials) ? body.materials : [])
    .filter((m) => typeof m?.name === 'string' && m.name.trim() !== '')
    .slice(0, 40)
    .map((m) => ({ name: m.name.trim().slice(0, 80), qty: typeof m.qty === 'number' && Number.isFinite(m.qty) ? m.qty : null, unit: m.unit?.trim().slice(0, 12) || null }));
  const date = optionalDate(body.date, 'date');
  const dueDate = optionalDate(body.dueDate, 'dueDate');
  const now = Date.now();

  const existing = (await db.query(`select * from work_orders where id = $1 for update`, [id]))[0];
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
    const code = `${year}-${String(Number(counter[0]?.last ?? 1)).padStart(5, '0')}`;
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

async function overview(db: Db, date: IsoDate): Promise<ManagerOverviewResponse> {
  const now = Date.now();
  const recent = now - 30 * DAY_MS;
  const [projects, sites, userRows, orders, dayEntriesRaw, summaries] = await Promise.all([
    db.query(`select * from projects where active order by code`),
    db.query(`${SITE_SELECT} where s.active order by p.code, s.name`),
    db.query(`select * from users where role = 'WORKER' and active order by display_name`),
    loadOrders(db, `where o.status <> 'COMPLETED' or o.updated_at > $1 or exists (select 1 from time_entries t where t.work_order_id = o.id and t.date = $2) order by o.code`, [recent, date]),
    db.query(`select * from time_entries where date = $1`, [date]),
    db.query(`select * from daily_summaries where date = $1`, [date]),
  ]);
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
    return {
      user: publicUser(u),
      presence: open ? 'WORKING' : shifts.length > 0 ? 'FINISHED' : 'NOT_STARTED',
      site: recentOrder ? (siteById.get(recentOrder.siteId) ?? null) : null,
      activeOrderCode: activeSeg ? (orderById.get(activeSeg.workOrderId ?? '')?.code ?? null) : null,
      shiftStartedAt: shifts[0]?.startedAt ?? null,
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

async function projectsList(db: Db): Promise<ManagerProjectsResponse> {
  const now = Date.now();
  const [projects, sites, orders, minutes, issues] = await Promise.all([
    db.query(`select * from projects where active order by code`),
    db.query(`${SITE_SELECT} where s.active order by p.code, s.name`),
    loadOrders(db, `order by o.code desc nulls first`),
    db.query(`select work_order_id, started_at, ended_at from time_entries where kind = 'ORDER'`),
    db.query(`select work_order_id, count(*)::int as n from logs where kind = 'ISSUE' group by work_order_id`),
  ]);
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
      return {
        project,
        sites: siteList.filter((s) => s.projectId === project.id),
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
