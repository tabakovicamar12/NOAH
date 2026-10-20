import { HttpErrorResponse, HttpResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { from, type Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  AdminUser,
  AdminUserCreate,
  AdminUserUpdate,
  AssignmentUpdate,
  ConsentRequest,
  HoursResponse,
  LoginRequest,
  LoginResponse,
  ManagerDirectoryResponse,
  ManagerOverviewResponse,
  ManagerProjectsResponse,
  OrderOverview,
  OrgInfo,
  PhotoView,
  PasswordReset,
  ProjectCreate,
  ProjectUpdate,
  SiteCreate,
  SiteUpdate,
  SummaryDetailResponse,
  SummaryReviewRequest,
  WorkOrderDetailResponse,
  WorkOrderStatusRequest,
  WorkOrderUpsert,
  WorkerOverview,
} from '../core/models/api.models';
import {
  CONSENT_VERSION,
  QUANTITY_UNITS,
  ROLES,
  canApproveReports,
  isDeskRole,
  type DailySummary,
  type IsoDate,
  type LogEntry,
  type PhotoMeta,
  type Project,
  type Site,
  type TimeEntry,
  type User,
  type WorkOrder,
  type WorkOrderStatus,
} from '../core/models/domain.models';
import { compareCodes, isIsoDate, minutesBetween, toIsoDate } from '../core/util/util';
import { isMonth, monthOf, monthWindow } from '../core/worktime/worktime';
import { houseModel } from '../core/models/house-catalog';
import { MockServerDb, type Archivable, type MockOrder, type MockPhoto, type MockUser } from './mock-db';
import { crewOf, ensureSeeded, siteLabel } from './mock-seed';

/**
 * In-browser implementation of AON API v1, wired as the last HTTP interceptor.
 * Behaves like a real server: auth, validation, idempotency, status transitions, network failure
 * when the device is offline. Remove `provideMockBackend()` to talk to a real API.
 */

class MockHttpError extends Error {
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

const TOKEN_TTL_MS = 12 * 3_600_000;
const OPEN_STATUSES: readonly WorkOrderStatus[] = ['NEW', 'IN_PROGRESS', 'ISSUE'];

let ready: Promise<MockServerDb> | null = null;
const objectUrls = new Map<string, string>();

function database(): Promise<MockServerDb> {
  if (!ready) {
    const db = new MockServerDb();
    ready = db.open().then(async () => {
      await ensureSeeded(db);
      return db;
    });
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

function latency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 260));
}

function publicUser(u: MockUser): User {
  return {
    id: u.id,
    displayName: u.displayName,
    role: u.role,
    ...(u.crew ? { crew: u.crew } : {}),
  };
}

function publicOrder(o: MockOrder): WorkOrder {
  const { crewIds: _crewIds, ...rest } = o;
  return rest;
}

async function authenticate(db: MockServerDb, req: HttpRequest<unknown>): Promise<MockUser> {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer mock\.([\w-]+)\.(\d+)$/.exec(header);
  if (!match) throw new MockHttpError(401, 'Missing or malformed token');
  const [, userId, exp] = match;
  if (!userId || Number(exp) < Date.now()) throw new MockHttpError(401, 'Token expired');
  const user = await db.users.get(userId);
  if (!user || user.active === false) throw new MockHttpError(401, 'Unknown user');
  return user;
}

function requireRole(user: MockUser, role: User['role']): void {
  if (user.role !== role) throw new MockHttpError(403, 'Forbidden for this role');
}

function requireDesk(user: MockUser): void {
  if (!isDeskRole(user.role)) throw new MockHttpError(403, 'Forbidden for this role');
}

function requireAdmin(user: MockUser): void {
  if (user.role !== 'ADMIN') throw new MockHttpError(403, 'Forbidden for this role');
}

const isActive = (x: object): boolean => (x as Archivable).active !== false;

/** Same rule as the server: administrator all, manager the objects of their projects, foreman their objects. */
async function scopeSites(db: MockServerDb, me: MockUser): Promise<ReadonlySet<string> | 'ALL'> {
  if (me.role === 'ADMIN') return 'ALL';
  const sites = await db.sites.toArray();
  if (me.role === 'MANAGER') return new Set(sites.filter((s) => (me.projectIds ?? []).includes(s.projectId)).map((s) => s.id));
  if (me.role === 'FOREMAN') return new Set(me.siteIds ?? []);
  return new Set();
}
const inScope = (scope: ReadonlySet<string> | 'ALL', siteId: string): boolean => scope === 'ALL' || scope.has(siteId);
async function scopeProjects(db: MockServerDb, me: MockUser, scope: ReadonlySet<string> | 'ALL'): Promise<ReadonlySet<string> | 'ALL'> {
  if (scope === 'ALL') return 'ALL';
  const ids = new Set((await db.sites.toArray()).filter((s) => scope.has(s.id)).map((s) => s.projectId));
  for (const p of me.projectIds ?? []) ids.add(p);
  return ids;
}

function adminUser(u: MockUser, projects: readonly (Project & Archivable)[], sites: readonly (Site & Archivable)[], orders: readonly MockOrder[]): AdminUser {
  const led = sites.filter((s) => (u.siteIds ?? []).includes(s.id) && isActive(s));
  const projectIds = u.role === 'MANAGER' ? (u.projectIds ?? []) : [...new Set(led.map((s) => s.projectId))];
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    crew: u.crew ?? null,
    active: u.active !== false,
    projects: projects.filter((p) => projectIds.includes(p.id) && isActive(p)).map((p) => ({ id: p.id, code: p.code, name: p.name })),
    sites: u.role === 'FOREMAN' ? led.map((s) => ({ id: s.id, code: s.code, name: s.name })) : [],
    openOrders: orders.filter((o) => o.published && OPEN_STATUSES.includes(o.status) && o.crewIds.includes(u.id)).length,
  };
}

function requireCode(value: unknown): string {
  const code = requireString(value, 'code').trim().toUpperCase();
  if (!/^[\p{L}\p{N}._-]{1,20}$/u.test(code)) throw new MockHttpError(400, 'INVALID_CODE');
  return code;
}

function bodyAs<T>(req: HttpRequest<unknown>): T {
  if (req.body == null || typeof req.body !== 'object') throw new MockHttpError(400, 'Body required');
  return req.body as T;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new MockHttpError(400, `${field} is required`);
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new MockHttpError(400, `${field} must be a number`);
  return value;
}

function optionalDate(value: unknown, field: string): IsoDate | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !isIsoDate(value)) throw new MockHttpError(400, `${field} must be YYYY-MM-DD`);
  return value;
}

async function withIdempotency(db: MockServerDb, req: HttpRequest<unknown>, fn: () => Promise<void>): Promise<null> {
  const key = req.headers.get('Idempotency-Key');
  if (!key) throw new MockHttpError(400, 'Idempotency-Key header required');
  if (await db.idempotency.get(key)) return null;
  await fn();
  await db.idempotency.put({ key, at: Date.now() });
  lastChangeAt = Date.now();
  return null;
}

/** Time of the last mutation, for GET /manager/changes. */
let lastChangeAt = Date.now();

function entryMinutes(e: TimeEntry, now: number): number {
  return minutesBetween(e.startedAt, e.endedAt ?? now);
}

function photoUrl(p: { id: string; blob: Blob | null }): string | null {
  if (!p.blob) return null;
  let url = objectUrls.get(p.id);
  if (!url) {
    url = URL.createObjectURL(p.blob);
    objectUrls.set(p.id, url);
  }
  return url;
}

function photoViews(photos: readonly MockPhoto[], users: ReadonlyMap<string, MockUser>): PhotoView[] {
  return [...photos]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ blob, ...meta }) => ({ ...meta, url: photoUrl({ id: meta.id, blob }), userName: users.get(meta.userId)?.displayName ?? '' }));
}

/** Next order number for the year: `2026-00130`. */
async function nextOrderCode(db: MockServerDb): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;
  const max = (await db.orders.toArray())
    .map((o) => o.code)
    .filter((c): c is string => !!c && c.startsWith(prefix))
    .reduce((m, c) => Math.max(m, Number(c.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

async function upsertOrder(db: MockServerDb, me: MockUser, id: string, body: WorkOrderUpsert): Promise<void> {
  if (body.id !== id) throw new MockHttpError(400, 'id mismatch');
  const title = requireString(body.title, 'title').trim().slice(0, 140);
  const site = await db.sites.get(requireString(body.siteId, 'siteId'));
  if (!site) throw new MockHttpError(404, 'Object not found');
  if (!QUANTITY_UNITS.includes(body.unit)) throw new MockHttpError(400, 'unit invalid');
  const plannedQty = requireNumber(body.plannedQty, 'plannedQty');
  if (plannedQty <= 0) throw new MockHttpError(400, 'plannedQty must be positive');
  if (!Array.isArray(body.crewIds)) throw new MockHttpError(400, 'crewIds required');
  const users = await db.users.where('role').equals('WORKER').toArray();
  const crewIds = [...new Set(body.crewIds)];
  if (crewIds.some((cid) => !users.some((u) => u.id === cid))) throw new MockHttpError(400, 'Unknown worker in crew');
  if (body.published && crewIds.length === 0) throw new MockHttpError(400, 'An assigned order needs at least one worker');

  const existing = await db.orders.get(id);
  if (existing) {
    const worked = new Set((await db.timeEntries.where('workOrderId').equals(id).toArray()).map((e) => e.userId));
    const removed = [...worked].filter((uid) => !crewIds.includes(uid));
    if (removed.length) throw new MockHttpError(409, 'Workers with recorded time cannot be removed');
    if (worked.size > 0 && (existing.siteId !== site.id || existing.unit !== body.unit || existing.plannedQty !== plannedQty)) {
      throw new MockHttpError(409, 'Object, unit and plan are locked once work has started');
    }
  }

  const order: MockOrder = {
    id,
    code: existing?.code ?? (await nextOrderCode(db)),
    title,
    description: (body.description ?? '').trim().slice(0, 4000),
    projectId: site.projectId,
    siteId: site.id,
    siteName: siteLabel(site),
    location: (body.location ?? '').trim().slice(0, 140),
    crewIds,
    crew: crewOf(crewIds, users),
    managerId: existing?.managerId ?? me.id,
    managerName: existing?.managerName ?? me.displayName,
    status: existing?.status ?? 'NEW',
    published: existing?.published === true ? true : body.published === true,
    unit: body.unit,
    plannedQty,
    doneQty: existing?.doneQty ?? 0,
    estimatedMinutes: body.estimatedMinutes === null ? null : Math.max(0, Math.round(requireNumber(body.estimatedMinutes, 'estimatedMinutes'))),
    materials: (body.materials ?? [])
      .filter((m) => typeof m?.name === 'string' && m.name.trim() !== '')
      .slice(0, 40)
      .map((m) => ({ name: m.name.trim().slice(0, 80), qty: typeof m.qty === 'number' && Number.isFinite(m.qty) ? m.qty : null, unit: m.unit?.trim() || null })),
    date: optionalDate(body.date, 'date'),
    dueDate: optionalDate(body.dueDate, 'dueDate'),
    updatedAt: Date.now(),
  };
  await db.orders.put(order);
}

async function route(req: HttpRequest<unknown>): Promise<unknown> {
  const db = await database();
  const url = new URL(req.urlWithParams, location.origin);
  const path = url.pathname.slice(environment.apiBaseUrl.length) || '/';
  const method = req.method.toUpperCase();
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);

  // ---- public
  if (method === 'GET' && path === '/health') return { ok: true, serverTime: Date.now() };

  if (method === 'POST' && path === '/auth/login') {
    const body = bodyAs<LoginRequest>(req);
    const username = requireString(body.username, 'username').trim().toLowerCase();
    const password = requireString(body.password, 'password');
    const user = await db.users.where('username').equals(username).first();
    if (!user || user.password !== password || user.active === false) throw new MockHttpError(401, 'INVALID_CREDENTIALS');
    if ((body.role === 'WORKER') !== (user.role === 'WORKER')) throw new MockHttpError(403, 'ROLE_MISMATCH');
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    const consents = (await db.consents.where('userId').equals(user.id).toArray()).sort((a, b) => b.acceptedAt - a.acceptedAt);
    const pick = (c: { version: string; acceptedAt: number } | undefined): { version: string; acceptedAt: number } | null =>
      c ? { version: c.version, acceptedAt: c.acceptedAt } : null;
    const res: LoginResponse = {
      token: `mock.${user.id}.${expiresAt}`,
      expiresAt,
      user: publicUser(user),
      consents: { notice: pick(consents.find((c) => c.version === CONSENT_VERSION)), voice: pick(consents.find((c) => c.version.startsWith('voice-'))) },
    };
    return res;
  }

  if (method === 'GET' && path === '/org') {
    const org: OrgInfo = { name: null, address: null, taxId: null, privacyContact: null, dpo: null, photoRetentionDays: null };
    return org;
  }

  const me = await authenticate(db, req);

  // ---- worker
  if (method === 'GET' && path === '/worker/orders') {
    requireRole(me, 'WORKER');
    const orders = await db.orders.where('crewIds').equals(me.id).toArray();
    const sites = (await db.sites.toArray()).filter((x) => (x as Site & Archivable).active !== false);
    return { orders: orders.filter((o) => o.published).map(publicOrder), sites, serverTime: Date.now() };
  }

  if (method === 'GET' && path === '/worker/daily-summary') {
    requireRole(me, 'WORKER');
    const date = url.searchParams.get('date') ?? '';
    if (!isIsoDate(date)) throw new MockHttpError(400, 'date must be YYYY-MM-DD');
    return (await db.summaries.get(`sum-${me.id}-${date}`)) ?? null;
  }

  if (method === 'GET' && path === '/worker/day') {
    requireRole(me, 'WORKER');
    const date = url.searchParams.get('date') ?? '';
    const from = Number(url.searchParams.get('from'));
    if (!isIsoDate(date) || !Number.isFinite(from)) throw new MockHttpError(400, 'date and from required');
    const [entries, logs] = await Promise.all([
      db.timeEntries.where('userId').equals(me.id).toArray(),
      db.logs.where('userId').equals(me.id).toArray(),
    ]);
    return {
      timeEntries: entries.filter((e) => e.date === date || e.endedAt === null).sort((a, b) => a.startedAt - b.startedAt),
      logs: logs.filter((l) => l.createdAt >= from && l.createdAt < from + 26 * 3_600_000).sort((a, b) => a.createdAt - b.createdAt),
    };
  }

  if (method === 'GET' && path === '/worker/hours') {
    requireRole(me, 'WORKER');
    return hours(db, monthParam(url), [me.id]);
  }

  if (method === 'GET' && path === '/manager/changes') {
    requireDesk(me);
    return { changedAt: lastChangeAt };
  }

  if (method === 'POST' && path === '/consents') {
    const body = bodyAs<ConsentRequest>(req);
    return withIdempotency(db, req, async () => {
      await db.consents.put({
        key: `${me.id}:${requireString(body.version, 'version')}`,
        userId: me.id,
        version: body.version,
        acceptedAt: requireNumber(body.acceptedAt, 'acceptedAt'),
      });
    });
  }

  if (method === 'PUT' && segments[0] === 'time-entries' && segments[1]) {
    const body = bodyAs<TimeEntry>(req);
    return withIdempotency(db, req, async () => {
      if (body.id !== segments[1]) throw new MockHttpError(400, 'id mismatch');
      if (body.userId !== me.id) throw new MockHttpError(403, 'Not your time entry');
      requireNumber(body.startedAt, 'startedAt');
      if (body.endedAt !== null && requireNumber(body.endedAt, 'endedAt') < body.startedAt) {
        throw new MockHttpError(400, 'endedAt before startedAt');
      }
      const existing = await db.timeEntries.get(body.id);
      if (existing && existing.startedAt !== body.startedAt) throw new MockHttpError(409, 'A recorded start cannot be changed');
      if (existing?.endedAt != null && existing.endedAt !== body.endedAt) throw new MockHttpError(409, 'A recorded end cannot be changed');
      if (body.kind === 'ORDER' && !(body.workOrderId && (await db.orders.get(body.workOrderId)))) {
        throw new MockHttpError(404, 'Work order not found');
      }
      await db.timeEntries.put({ ...body });
    });
  }

  if (method === 'POST' && segments[0] === 'work-orders' && segments[1] && segments[2] === 'status') {
    const body = bodyAs<WorkOrderStatusRequest>(req);
    const id = segments[1];
    return withIdempotency(db, req, async () => {
      const current = await db.orders.get(id);
      if (!current) throw new MockHttpError(404, 'Work order not found');
      if (!current.crewIds.includes(me.id) && me.role !== 'MANAGER') throw new MockHttpError(403, 'Not in this crew');
      // A crewmate who was offline may still start or flag an order someone else already finished: no-op.
      if (current.status === 'COMPLETED') return;
      if (!ALLOWED_TRANSITIONS[current.status].includes(body.status)) {
        throw new MockHttpError(409, `Transition ${current.status} → ${body.status} not allowed`);
      }
      await db.orders.put({ ...current, status: body.status, updatedAt: requireNumber(body.changedAt, 'changedAt') });
    });
  }

  if (method === 'POST' && path === '/logs') {
    const body = bodyAs<LogEntry>(req);
    return withIdempotency(db, req, async () => {
      if (body.userId !== me.id) throw new MockHttpError(403, 'Not your entry');
      const target = await db.orders.get(requireString(body.workOrderId, 'workOrderId'));
      if (!target) throw new MockHttpError(404, 'Work order not found');
      if (body.kind === 'QUANTITY') {
        const q = requireNumber(body.quantity, 'quantity');
        if (q === 0) throw new MockHttpError(400, 'quantity must not be zero');
        if (q < 0 && !(typeof body.text === 'string' && body.text.trim())) throw new MockHttpError(400, 'A correction needs a reason');
        if (target.doneQty + q < 0) throw new MockHttpError(409, 'QUANTITY_BELOW_ZERO');
        await db.orders.put({ ...target, doneQty: Math.round((target.doneQty + q) * 100) / 100, updatedAt: Date.now() });
      } else {
        requireString(body.text, 'text');
      }
      await db.logs.put({ ...body });
    });
  }

  if (method === 'POST' && path === '/photos') {
    // Same protocol as the server: the bare JPEG, metadata in X-Photo-Meta (base64url JSON).
    const header = req.headers.get('X-Photo-Meta');
    const file = req.body;
    if (!header || !(file instanceof Blob)) throw new MockHttpError(400, 'X-Photo-Meta header and JPEG body required');
    const json = atob(header.replace(/-/g, '+').replace(/_/g, '/'));
    const meta = JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (ch) => ch.charCodeAt(0)))) as PhotoMeta;
    return withIdempotency(db, req, async () => {
      if (meta.userId !== me.id) throw new MockHttpError(403, 'Not your photo');
      if (!meta.privacyConfirmed) throw new MockHttpError(400, 'Privacy confirmation missing');
      if (file.size > 8 * 1024 * 1024) throw new MockHttpError(413, 'File too large');
      await db.photos.put({ ...meta, blob: file });
    });
  }

  if (method === 'PUT' && segments[0] === 'daily-summaries' && segments[1]) {
    const body = bodyAs<DailySummary>(req);
    return withIdempotency(db, req, async () => {
      if (body.userId !== me.id) throw new MockHttpError(403, 'Not your summary');
      if (!Array.isArray(body.lines)) throw new MockHttpError(400, 'lines required');
      const existing = await db.summaries.get(segments[1] ?? '');
      if (existing?.status === 'APPROVED') throw new MockHttpError(409, 'Summary already approved');
      await db.summaries.put({ ...body, status: 'SUBMITTED', reviewedAt: null, reviewerName: null, reviewerNote: null });
    });
  }

  // ---- manager
  if (method === 'GET' && path === '/manager/directory') {
    requireDesk(me);
    const scope = await scopeSites(db, me);
    const projectScope = await scopeProjects(db, me, scope);
    const [allProjects, allSites, allUsers, orders] = await Promise.all([
      db.projects.toArray(),
      db.sites.toArray(),
      db.users.where('role').equals('WORKER').toArray(),
      db.orders.toArray(),
    ]);
    const projects = allProjects.filter((p) => isActive(p) && (projectScope === 'ALL' || projectScope.has(p.id)));
    const sites = allSites.filter((s) => isActive(s) && inScope(scope, s.id));
    const users = allUsers.filter((u) => u.active !== false);
    const res: ManagerDirectoryResponse = {
      projects,
      sites,
      workers: users
        .map((u) => ({
          user: publicUser(u),
          openOrders: orders.filter((o) => o.published && OPEN_STATUSES.includes(o.status) && o.crewIds.includes(u.id)).length,
        }))
        .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName, 'sl')),
      serverTime: Date.now(),
    };
    return res;
  }

  if (method === 'PUT' && segments[0] === 'manager' && segments[1] === 'work-orders' && segments[2]) {
    requireDesk(me);
    const body = bodyAs<WorkOrderUpsert>(req);
    const id = segments[2];
    const scope = await scopeSites(db, me);
    const existing = await db.orders.get(id);
    if (!inScope(scope, String(body.siteId)) || (existing && !inScope(scope, existing.siteId))) throw new MockHttpError(403, 'OUT_OF_SCOPE');
    return withIdempotency(db, req, () => upsertOrder(db, me, id, body));
  }

  if (method === 'GET' && path === '/manager/overview') {
    requireDesk(me);
    const dateParam = url.searchParams.get('date') ?? toIsoDate();
    if (!isIsoDate(dateParam)) throw new MockHttpError(400, 'date must be YYYY-MM-DD');
    const scope = await scopeSites(db, me);
    const full = await overview(db, dateParam);
    if (scope === 'ALL') return full;
    const orders = full.orders.filter((o) => inScope(scope, o.order.siteId));
    const visible = new Set(orders.flatMap((o) => o.order.crew.map((c) => c.id)));
    const projectScope = await scopeProjects(db, me, scope);
    const scoped: ManagerOverviewResponse = {
      ...full,
      projects: full.projects.filter((p) => projectScope === 'ALL' || projectScope.has(p.id)),
      sites: full.sites.filter((s) => inScope(scope, s.id)),
      orders,
      workers: full.workers.filter((w) => visible.has(w.user.id)),
      summaries: full.summaries.filter((s) => visible.has(s.userId)),
    };
    return scoped;
  }

  if (method === 'GET' && path === '/manager/hours') {
    requireDesk(me);
    const month = monthParam(url);
    const scope = await scopeSites(db, me);
    if (scope === 'ALL') return hours(db, month, null);
    const { from, to } = monthWindow(month);
    const orders = (await db.orders.toArray()).filter((o) => inScope(scope, o.siteId));
    const ids = new Set(orders.flatMap((o) => o.crewIds));
    const orderIds = new Set(orders.map((o) => o.id));
    for (const e of await db.timeEntries.where('date').between(from, to, true, true).toArray()) {
      if (e.workOrderId && orderIds.has(e.workOrderId)) ids.add(e.userId);
    }
    return hours(db, month, [...ids]);
  }

  if (method === 'GET' && path === '/manager/projects') {
    requireDesk(me);
    const now = Date.now();
    const scope = await scopeSites(db, me);
    const projectScope = await scopeProjects(db, me, scope);
    const [allProjects, allSites, orders, entries, logs, users] = await Promise.all([
      db.projects.toArray(),
      db.sites.toArray(),
      db.orders.toArray(),
      db.timeEntries.toArray(),
      db.logs.toArray(),
      db.users.toArray(),
    ]);
    const projects = allProjects.filter((p) => isActive(p) && (projectScope === 'ALL' || projectScope.has(p.id)));
    const sites = allSites.filter((s) => isActive(s) && inScope(scope, s.id));
    const leaders = users.filter((u) => u.active !== false);
    const member = (u: MockUser): { id: string; displayName: string } => ({ id: u.id, displayName: u.displayName });
    const res: ManagerProjectsResponse = {
      projects: projects.map((project) => ({
        project,
        sites: sites.filter((s) => s.projectId === project.id),
        managers: leaders.filter((u) => u.role === 'MANAGER' && (u.projectIds ?? []).includes(project.id)).map(member),
        foremen: Object.fromEntries(
          sites
            .filter((s) => s.projectId === project.id)
            .map((s) => [s.id, leaders.filter((u) => u.role === 'FOREMAN' && (u.siteIds ?? []).includes(s.id)).map(member)]),
        ),
        orders: orders
          .filter((o) => o.projectId === project.id && inScope(scope, o.siteId))
          .sort((a, b) => compareCodes(b.code, a.code))
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
            minutesTotal: entries.filter((e) => e.kind === 'ORDER' && e.workOrderId === o.id).reduce((m, e) => m + entryMinutes(e, now), 0),
            dueDate: o.dueDate,
            openIssues: o.status === 'ISSUE' ? Math.max(1, logs.filter((l) => l.workOrderId === o.id && l.kind === 'ISSUE').length) : 0,
          })),
      })),
      serverTime: now,
    };
    return res;
  }

  if (method === 'POST' && path === '/manager/projects') {
    requireAdmin(me);
    const body = bodyAs<ProjectCreate>(req);
    const name = requireString(body.name, 'name').trim();
    const all = await db.projects.toArray();
    let code: string;
    if (body.code && body.code.trim()) {
      code = requireCode(body.code);
    } else {
      const prefix = `P-${new Date().getFullYear()}-`;
      const max = all.map((p) => p.code).filter((c) => c.startsWith(prefix)).reduce((m, c) => Math.max(m, Number(c.slice(prefix.length)) || 0), 0);
      code = `${prefix}${String(max + 1).padStart(3, '0')}`;
    }
    if (all.some((p) => p.code === code)) throw new MockHttpError(409, 'CODE_TAKEN');
    const project: Project = { id: `p-${crypto.randomUUID()}`, code, name };
    await db.projects.put(project);
    return project;
  }

  if (method === 'POST' && path === '/manager/sites') {
    requireAdmin(me);
    const body = bodyAs<SiteCreate>(req);
    const project = await db.projects.get(requireString(body.projectId, 'projectId'));
    if (!project) throw new MockHttpError(404, 'Project not found');
    const siblings = (await db.sites.toArray()).filter((s) => s.projectId === project.id);
    const code = body.code && body.code.trim() ? requireCode(body.code) : `O-${siblings.length + 1}`;
    const name = requireString(body.name, 'name').trim();
    if (siblings.some((s) => s.code === code)) throw new MockHttpError(409, 'CODE_TAKEN');
    const model = body.houseModel ?? null;
    if (model !== null && !houseModel(model)) throw new MockHttpError(400, 'Unknown house model');
    const site: Site = {
      id: `s-${crypto.randomUUID()}`,
      code,
      projectId: project.id,
      projectName: project.name,
      name,
      city: typeof body.city === 'string' ? body.city.trim() : '',
      houseModel: model,
    };
    await db.sites.put(site);
    return site;
  }

  if (method === 'GET' && segments[0] === 'manager' && segments[1] === 'work-orders' && segments[2]) {
    requireDesk(me);
    const order = await db.orders.get(segments[2]);
    if (order && !inScope(await scopeSites(db, me), order.siteId)) throw new MockHttpError(403, 'OUT_OF_SCOPE');
    return orderDetail(db, segments[2]);
  }

  if (method === 'GET' && segments[0] === 'manager' && segments[1] === 'daily-summaries' && segments[2]) {
    requireDesk(me);
    return summaryDetail(db, segments[2]);
  }

  // ---- administrator
  if (method === 'GET' && path === '/admin/users') {
    requireAdmin(me);
    const [users, projects, sites, orders] = await Promise.all([db.users.toArray(), db.projects.toArray(), db.sites.toArray(), db.orders.toArray()]);
    const list = users
      .map((u) => adminUser(u, projects, sites, orders))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.displayName.localeCompare(b.displayName, 'sl'));
    return { users: list };
  }

  if (method === 'POST' && path === '/admin/users') {
    requireAdmin(me);
    const body = bodyAs<AdminUserCreate>(req);
    const username = requireString(body.username, 'username').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new MockHttpError(400, 'INVALID_USERNAME');
    if (typeof body.password !== 'string' || body.password.length < 10) throw new MockHttpError(400, 'PASSWORD_TOO_SHORT');
    if (!ROLES.includes(body.role)) throw new MockHttpError(400, 'role invalid');
    if (await db.users.where('username').equals(username).first()) throw new MockHttpError(409, 'USERNAME_TAKEN');
    const id = `u-${crypto.randomUUID()}`;
    const crew = body.crew?.trim();
    await db.users.put({ id, username, password: body.password, displayName: requireString(body.displayName, 'displayName').trim(), role: body.role, ...(crew ? { crew } : {}) });
    return { id };
  }

  if (method === 'PATCH' && segments[0] === 'admin' && segments[1] === 'users' && segments[2] && !segments[3]) {
    requireAdmin(me);
    const body = bodyAs<AdminUserUpdate>(req);
    const user = await db.users.get(segments[2]);
    if (!user) throw new MockHttpError(404, 'User not found');
    const role = body.role ?? user.role;
    if (!ROLES.includes(role)) throw new MockHttpError(400, 'role invalid');
    const active = body.active ?? user.active !== false;
    if (user.id === me.id && (role !== user.role || !active)) throw new MockHttpError(409, 'SELF_LOCKOUT');
    if (user.role === 'ADMIN' && user.active !== false && (role !== 'ADMIN' || !active)) {
      const others = (await db.users.toArray()).filter((u) => u.role === 'ADMIN' && u.active !== false && u.id !== user.id);
      if (others.length === 0) throw new MockHttpError(409, 'LAST_ADMIN');
    }
    if (user.role === 'WORKER' && role !== 'WORKER') {
      const open = (await db.orders.where('crewIds').equals(user.id).toArray()).some((o) => o.status !== 'COMPLETED');
      if (open) throw new MockHttpError(409, 'OPEN_ORDERS');
    }
    const crew = body.crew === undefined ? user.crew : body.crew?.trim() || undefined;
    const { crew: _old, projectIds, siteIds, ...rest } = user;
    await db.users.put({
      ...rest,
      displayName: body.displayName?.trim() || user.displayName,
      role,
      active,
      ...(crew ? { crew } : {}),
      ...(role === 'MANAGER' && projectIds ? { projectIds } : {}),
      ...(role === 'FOREMAN' && siteIds ? { siteIds } : {}),
    });
    return null;
  }

  if (method === 'POST' && segments[0] === 'admin' && segments[1] === 'users' && segments[2] && segments[3] === 'password') {
    requireAdmin(me);
    const body = bodyAs<PasswordReset>(req);
    if (typeof body.password !== 'string' || body.password.length < 10) throw new MockHttpError(400, 'PASSWORD_TOO_SHORT');
    const user = await db.users.get(segments[2]);
    if (!user) throw new MockHttpError(404, 'User not found');
    await db.users.put({ ...user, password: body.password });
    return null;
  }

  if (method === 'PATCH' && segments[0] === 'admin' && (segments[1] === 'projects' || segments[1] === 'sites') && segments[2] && !segments[3]) {
    requireAdmin(me);
    const isProject = segments[1] === 'projects';
    const body = bodyAs<ProjectUpdate & SiteUpdate>(req);
    const table = isProject ? db.projects : db.sites;
    const row = (await table.get(segments[2])) as (Project | Site) & Archivable | undefined;
    if (!row) throw new MockHttpError(404, 'Not found');
    if (body.active === false && isActive(row)) {
      const open = (await db.orders.toArray()).some((o) => (isProject ? o.projectId : o.siteId) === row.id && o.status !== 'COMPLETED');
      if (open) throw new MockHttpError(409, 'OPEN_ORDERS');
    }
    const next = {
      ...row,
      ...(body.name?.trim() ? { name: body.name.trim() } : {}),
      ...(!isProject && body.city !== undefined ? { city: body.city.trim() } : {}),
      ...(!isProject && body.houseModel !== undefined ? { houseModel: body.houseModel || null } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    };
    await (table as typeof db.sites).put(next as Site);
    return null;
  }

  if (method === 'PUT' && segments[0] === 'admin' && (segments[1] === 'projects' || segments[1] === 'sites') && segments[2] && (segments[3] === 'managers' || segments[3] === 'foremen')) {
    requireAdmin(me);
    const body = bodyAs<AssignmentUpdate>(req);
    const role = segments[3] === 'managers' ? 'MANAGER' : 'FOREMAN';
    const key = role === 'MANAGER' ? 'projectIds' : 'siteIds';
    const target = segments[2];
    const ids = new Set(Array.isArray(body.userIds) ? body.userIds : []);
    const users = await db.users.toArray();
    if ([...ids].some((id) => !users.some((u) => u.id === id && u.role === role && u.active !== false))) {
      throw new MockHttpError(400, `Every user must be an active ${role.toLowerCase()}`);
    }
    for (const u of users.filter((x) => x.role === role)) {
      const current = new Set(u[key] ?? []);
      if (ids.has(u.id)) current.add(target);
      else current.delete(target);
      await db.users.put({ ...u, [key]: [...current] });
    }
    return null;
  }

  if (method === 'POST' && segments[0] === 'daily-summaries' && segments[1] && segments[2] === 'review') {
    if (!canApproveReports(me.role)) throw new MockHttpError(403, 'Forbidden for this role');
    const body = bodyAs<SummaryReviewRequest>(req);
    const existing = await db.summaries.get(segments[1]);
    if (!existing) throw new MockHttpError(404, 'Summary not found');
    if (body.decision !== 'APPROVED' && body.decision !== 'RETURNED') throw new MockHttpError(400, 'Invalid decision');
    const note = body.note?.trim() || null;
    if (body.decision === 'RETURNED' && !note) throw new MockHttpError(400, 'A returned report needs a note');
    if (existing.status !== 'SUBMITTED') throw new MockHttpError(409, 'Only a submitted report can be reviewed');
    await db.summaries.put({ ...existing, status: body.decision, reviewedAt: Date.now(), reviewerName: me.displayName, reviewerNote: note });
    lastChangeAt = Date.now();
    return null;
  }

  throw new MockHttpError(404, `No route for ${method} ${path}`);
}

function monthParam(url: URL): string {
  const month = url.searchParams.get('month') ?? toIsoDate().slice(0, 7);
  if (!isMonth(month)) throw new MockHttpError(400, 'month must be YYYY-MM');
  return month;
}

/** Same contract as the server: a month of shifts with the year's run-up, the month's order segments and report states. */
async function hours(db: MockServerDb, month: string, userIds: readonly string[] | null): Promise<HoursResponse> {
  const { from, to } = monthWindow(month);
  const allow = userIds ? new Set(userIds) : null;
  const [users, entries, summaries, orders, sites] = await Promise.all([
    db.users.where('role').equals('WORKER').toArray(),
    db.timeEntries.where('date').between(from, to, true, true).toArray(),
    db.summaries.toArray(),
    db.orders.toArray(),
    db.sites.toArray(),
  ]);
  const mine = entries.filter((e) => !allow || allow.has(e.userId)).sort((a, b) => a.startedAt - b.startedAt);
  const shifts = mine.filter((e) => e.kind === 'SHIFT');
  const segments = mine.filter((e) => e.kind === 'ORDER' && monthOf(e.date) === month);
  const worked = new Set(shifts.filter((e) => monthOf(e.date) === month).map((e) => e.userId));
  const orderIds = new Set(segments.map((e) => e.workOrderId));
  const usedOrders = orders.filter((o) => orderIds.has(o.id));
  const siteIds = new Set(usedOrders.map((o) => o.siteId));
  return {
    month,
    from,
    to,
    workers: users
      .filter((u) => (!allow || allow.has(u.id)) && (u.active !== false || worked.has(u.id)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'sl'))
      .map(publicUser),
    shifts,
    segments,
    orders: usedOrders.map((o) => ({ id: o.id, code: o.code, title: o.title, siteId: o.siteId })),
    sites: sites.filter((s) => siteIds.has(s.id)),
    summaries: summaries.filter((s) => monthOf(s.date) === month && (!allow || allow.has(s.userId))).map((s) => ({ id: s.id, userId: s.userId, date: s.date, status: s.status })),
    serverTime: Date.now(),
  };
}

async function overview(db: MockServerDb, date: IsoDate): Promise<ManagerOverviewResponse> {
  const now = Date.now();
  const [projects, sites, users, orders, entries, photos, logs, summaries] = await Promise.all([
    db.projects.toArray(),
    db.sites.toArray(),
    db.users.where('role').equals('WORKER').toArray(),
    db.orders.toArray(),
    db.timeEntries.toArray(),
    db.photos.toArray(),
    db.logs.toArray(),
    db.summaries.where('date').equals(date).toArray(),
  ]);
  const dayEntries = entries.filter((e) => e.date === date);
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const workers: WorkerOverview[] = users.map((u) => {
    const shifts = dayEntries.filter((e) => e.userId === u.id && e.kind === 'SHIFT').sort((a, b) => a.startedAt - b.startedAt);
    const open = shifts.find((s) => s.endedAt === null) ?? null;
    const segs = dayEntries.filter((e) => e.userId === u.id && e.kind === 'ORDER').sort((a, b) => b.startedAt - a.startedAt);
    const activeSeg = segs.find((s) => s.endedAt === null) ?? null;
    const recentOrder =
      orderById.get(activeSeg?.workOrderId ?? segs[0]?.workOrderId ?? '') ?? orders.find((o) => o.published && o.crewIds.includes(u.id)) ?? null;
    const summary = summaries.find((s) => s.userId === u.id) ?? null;
    return {
      user: publicUser(u),
      presence: open ? 'WORKING' : shifts.length > 0 ? 'FINISHED' : 'NOT_STARTED',
      site: siteById.get((open ?? shifts.at(-1))?.siteId ?? '') ?? (recentOrder ? (siteById.get(recentOrder.siteId) ?? null) : null),
      activeOrderCode: activeSeg ? (orderById.get(activeSeg.workOrderId ?? '')?.code ?? null) : null,
      shiftStartedAt: shifts[0]?.startedAt ?? null,
      shiftEndedAt: open ? null : shifts.reduce<number | null>((m, s) => (s.endedAt != null && (m === null || s.endedAt > m) ? s.endedAt : m), null),
      minutesToday: shifts.reduce((sum, s) => sum + entryMinutes(s, now), 0),
      summaryId: summary?.id ?? null,
      summaryStatus: summary?.status ?? null,
    };
  });

  const orderRows: OrderOverview[] = orders.map((o) => {
    const segs = entries.filter((e) => e.kind === 'ORDER' && e.workOrderId === o.id);
    const onDay = (at: number): boolean => toIsoDate(at) === date;
    return {
      order: publicOrder(o),
      minutesToday: segs.filter((e) => e.date === date).reduce((s, e) => s + entryMinutes(e, now), 0),
      activeOnDate:
        segs.some((e) => e.date === date) ||
        logs.some((l) => l.workOrderId === o.id && onDay(l.createdAt)) ||
        photos.some((p) => p.workOrderId === o.id && onDay(p.createdAt)) ||
        o.date === date ||
        o.dueDate === date,
      minutesTotal: segs.reduce((s, e) => s + entryMinutes(e, now), 0),
      photoCount: photos.filter((p) => p.workOrderId === o.id).length,
      openIssues: o.status === 'ISSUE' ? Math.max(1, logs.filter((l) => l.workOrderId === o.id && l.kind === 'ISSUE').length) : 0,
    };
  });

  return { date, projects, sites, workers, orders: orderRows, summaries, serverTime: now };
}

async function orderDetail(db: MockServerDb, id: string): Promise<WorkOrderDetailResponse> {
  const order = await db.orders.get(id);
  if (!order) throw new MockHttpError(404, 'Work order not found');
  const [users, timeEntries, logs, photos, summaries] = await Promise.all([
    db.users.toArray(),
    db.timeEntries.where('workOrderId').equals(id).toArray(),
    db.logs.where('workOrderId').equals(id).toArray(),
    db.photos.where('workOrderId').equals(id).toArray(),
    db.summaries.toArray(),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  return {
    order: publicOrder(order),
    lockedCrewIds: [...new Set(timeEntries.map((e) => e.userId))],
    timeEntries: timeEntries.sort((a, b) => b.startedAt - a.startedAt),
    logs: logs.sort((a, b) => b.createdAt - a.createdAt),
    photos: photoViews(photos, userById),
    summaries: summaries
      .filter((s) => (order.code ? s.ordersWorked.includes(order.code) : false) || s.lines.some((l) => l.workOrderId === id))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.submittedAt ?? 0) - (a.submittedAt ?? 0)),
  };
}

async function summaryDetail(db: MockServerDb, id: string): Promise<SummaryDetailResponse> {
  const summary = await db.summaries.get(id);
  if (!summary) throw new MockHttpError(404, 'Summary not found');
  const worker = await db.users.get(summary.userId);
  if (!worker) throw new MockHttpError(404, 'Worker not found');
  const start = new Date(`${summary.date}T00:00:00`).getTime();
  const end = start + 86_400_000;
  const photos = (await db.photos.where('userId').equals(worker.id).toArray()).filter((p) => p.createdAt >= start && p.createdAt < end);
  return { summary, worker: publicUser(worker), photos: photoViews(photos, new Map([[worker.id, worker]])) };
}

async function handle(req: HttpRequest<unknown>): Promise<HttpResponse<unknown>> {
  await latency();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new HttpErrorResponse({ status: 0, statusText: 'Unknown Error', url: req.url, error: new ProgressEvent('error') });
  }
  try {
    const body = await route(req);
    return new HttpResponse({ status: 200, body, url: req.url });
  } catch (err: unknown) {
    if (err instanceof MockHttpError) {
      throw new HttpErrorResponse({ status: err.status, statusText: err.message, url: req.url, error: { message: err.message } });
    }
    throw new HttpErrorResponse({ status: 500, statusText: 'Mock server error', url: req.url, error: { message: String(err) } });
  }
}

export const mockBackendInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBaseUrl)) return next(req);
  return from(handle(req)) as Observable<HttpResponse<unknown>>;
};
