import type { Db } from './db';
import type {
  CrewMember,
  DailySummary,
  IsoDate,
  LogEntry,
  Material,
  PhotoMeta,
  Project,
  Site,
  TimeEntry,
  User,
  WorkOrder,
} from '../src/app/core/models/domain.models';

/** Row → domain mappers. Drivers return bigint/numeric as strings or BigInt, so numbers are coerced here. */

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

export interface UserRow extends User {
  readonly username: string;
  readonly passwordHash: string;
  readonly active: boolean;
}

export function toUser(r: Row): UserRow {
  return {
    id: str(r['id']),
    displayName: str(r['display_name']),
    role: str(r['role']) === 'MANAGER' ? 'MANAGER' : 'WORKER',
    ...(r['crew'] ? { crew: str(r['crew']) } : {}),
    ...(r['can_manage_projects'] === true ? { canManageProjects: true } : {}),
    username: str(r['username']),
    passwordHash: str(r['password_hash']),
    active: r['active'] !== false,
  };
}

export function publicUser(u: UserRow): User {
  return {
    id: u.id,
    displayName: u.displayName,
    role: u.role,
    ...(u.crew ? { crew: u.crew } : {}),
    ...(u.canManageProjects ? { canManageProjects: true } : {}),
  };
}

export function toProject(r: Row): Project {
  return { id: str(r['id']), code: str(r['code']), name: str(r['name']) };
}

export function toSite(r: Row): Site {
  return {
    id: str(r['id']),
    code: str(r['code']),
    projectId: str(r['project_id']),
    projectName: str(r['project_name']),
    name: str(r['name']),
    city: str(r['city']),
  };
}

export const SITE_SELECT = `select s.*, p.name as project_name from sites s join projects p on p.id = s.project_id`;

export const ORDER_SELECT = `
select o.*, p.name as project_name, s.name as site_name, m.display_name as manager_name
from work_orders o
join projects p on p.id = o.project_id
join sites s on s.id = o.site_id
join users m on m.id = o.manager_id`;

export function toOrder(r: Row, crew: readonly CrewMember[]): WorkOrder {
  return {
    id: str(r['id']),
    code: strOrNull(r['code']),
    title: str(r['title']),
    description: str(r['description']),
    projectId: str(r['project_id']),
    siteId: str(r['site_id']),
    siteName: `${str(r['project_name'])} · ${str(r['site_name'])}`,
    location: str(r['location']),
    crew,
    managerId: str(r['manager_id']),
    managerName: str(r['manager_name']),
    status: str(r['status']) as WorkOrder['status'],
    published: r['published'] === true,
    unit: str(r['unit']) as WorkOrder['unit'],
    plannedQty: num(r['planned_qty']),
    doneQty: num(r['done_qty']),
    estimatedMinutes: numOrNull(r['estimated_minutes']),
    materials: json<Material[]>(r['materials'], []),
    date: strOrNull(r['date']) as IsoDate | null,
    dueDate: strOrNull(r['due_date']) as IsoDate | null,
    updatedAt: num(r['updated_at']),
  };
}

/** Loads orders with their crews in two queries. */
export async function loadOrders(db: Db, where: string, params: readonly unknown[] = []): Promise<WorkOrder[]> {
  const rows = await db.query(`${ORDER_SELECT} ${where}`, params as never[]);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => str(r['id']));
  const crewRows = await db.query(
    `select c.order_id, u.id, u.display_name from work_order_crew c join users u on u.id = c.user_id
     where c.order_id = any($1::text[]) order by u.display_name`,
    [ids],
  );
  const crewBy = new Map<string, CrewMember[]>();
  for (const c of crewRows) {
    const list = crewBy.get(str(c['order_id'])) ?? [];
    list.push({ id: str(c['id']), displayName: str(c['display_name']) });
    crewBy.set(str(c['order_id']), list);
  }
  return rows.map((r) => toOrder(r, crewBy.get(str(r['id'])) ?? []));
}

export function toTimeEntry(r: Row): TimeEntry {
  return {
    id: str(r['id']),
    userId: str(r['user_id']),
    kind: str(r['kind']) === 'ORDER' ? 'ORDER' : 'SHIFT',
    workOrderId: strOrNull(r['work_order_id']),
    date: str(r['date']) as IsoDate,
    startedAt: num(r['started_at']),
    endedAt: numOrNull(r['ended_at']),
    ...(r['end_source'] ? { endSource: str(r['end_source']) as 'TAP' | 'DECLARED' } : {}),
    endNote: strOrNull(r['end_note']),
  };
}

export function toLog(r: Row): LogEntry {
  return {
    id: str(r['id']),
    userId: str(r['user_id']),
    workOrderId: str(r['work_order_id']),
    kind: str(r['kind']) as LogEntry['kind'],
    quantity: numOrNull(r['quantity']),
    text: strOrNull(r['text']),
    createdAt: num(r['created_at']),
  };
}

export function toPhoto(r: Row): PhotoMeta & { readonly storageKey: string } {
  return {
    id: str(r['id']),
    userId: str(r['user_id']),
    workOrderId: str(r['work_order_id']),
    projectId: str(r['project_id']),
    category: str(r['category']) as PhotoMeta['category'],
    caption: strOrNull(r['caption']),
    width: num(r['width']),
    height: num(r['height']),
    createdAt: num(r['created_at']),
    privacyConfirmed: r['privacy_confirmed'] === true,
    maskCount: num(r['mask_count']),
    storageKey: str(r['storage_key']),
  };
}

export function toSummary(r: Row): DailySummary {
  return {
    id: str(r['id']),
    userId: str(r['user_id']),
    date: str(r['date']) as IsoDate,
    arrivalAt: numOrNull(r['arrival_at']),
    departureAt: numOrNull(r['departure_at']),
    shiftMinutes: num(r['shift_minutes']),
    orderMinutes: num(r['order_minutes']),
    lines: json(r['lines'], []),
    ordersWorked: json(r['orders_worked'], []),
    issuesReported: num(r['issues_reported']),
    photosTaken: num(r['photos_taken']),
    declaredEnd: r['declared_end'] === true,
    corrections: json(r['corrections'], []),
    comment: str(r['comment']),
    status: str(r['status']) as DailySummary['status'],
    submittedAt: numOrNull(r['submitted_at']),
    reviewedAt: numOrNull(r['reviewed_at']),
    reviewerName: strOrNull(r['reviewer_name']),
    reviewerNote: strOrNull(r['reviewer_note']),
  };
}
