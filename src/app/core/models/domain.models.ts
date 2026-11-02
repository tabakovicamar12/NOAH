/**
 * AON domain model. Shared by the local store (Dexie), the API contract and the UI.
 * All timestamps are epoch milliseconds (device clock); all dates are ISO `YYYY-MM-DD` in local time.
 */

/**
 * Who does what (enforced by the server; the UI only hides what a role cannot do):
 * - ADMIN (administrator): accounts, projects, objects, who leads which project or object; everything a manager can.
 * - MANAGER (vodja): work orders and report approval on the projects the administrator assigned to them.
 * - FOREMAN (delovodja): work orders and crews on the objects assigned to them; cannot approve reports.
 * - WORKER (delavec): their own assigned orders, time, entries and daily report.
 */
export const ROLES = ['ADMIN', 'MANAGER', 'FOREMAN', 'WORKER'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that work on the desk surface (/m). */
export function isDeskRole(role: Role | null | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'FOREMAN';
}

/** Roles that may approve or return a worker's daily report. The one who records time never approves it. */
export function canApproveReports(role: Role | null | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

export function isAdmin(role: Role | null | undefined): boolean {
  return role === 'ADMIN';
}

export const WORK_ORDER_STATUSES = ['NEW', 'IN_PROGRESS', 'COMPLETED', 'ISSUE'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const PHOTO_CATEGORIES = ['BEFORE', 'IN_PROGRESS', 'FINISHED', 'ISSUE'] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

/** Units of work quantity: pieces, length, area, volume, hours, mass (kg, t) and sets (kpl). */
export const QUANTITY_UNITS = ['PCS', 'M', 'M2', 'M3', 'H', 'KG', 'T', 'KPL'] as const;
export type QuantityUnit = (typeof QUANTITY_UNITS)[number];

export type IsoDate = string & { readonly __brand: 'IsoDate' };
export type EpochMs = number;

export interface User {
  readonly id: string;
  readonly displayName: string;
  readonly role: Role;
  readonly crew?: string;
}

/** Projekt: the client job, e.g. "Hiša Novak". Holds one or more objects. */
export interface Project {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** Objekt: a place belonging to a project, e.g. "Maribor, Tezno". Work orders run on an object. */
export interface Site {
  readonly id: string;
  readonly code: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly name: string;
  readonly city: string;
  /** House from the catalogue (house-catalog.ts) built on this object; null when the name was typed by hand. */
  readonly houseModel?: string | null;
}

export interface CrewMember {
  readonly id: string;
  readonly displayName: string;
}

export interface Material {
  readonly name: string;
  readonly qty: number | null;
  readonly unit: string | null;
}

/** How much of one material a whole crew has used on an order so far. */
export interface MaterialUsage {
  readonly name: string;
  readonly unit: string | null;
  readonly qty: number;
}

/** One line of an order's materials as people read it: the plan, what was used, and whether it was planned at all. */
export interface MaterialLine {
  readonly key: string;
  readonly name: string;
  readonly unit: string | null;
  /** Null when the plan gives no amount, or the material was not on the order. */
  readonly planned: number | null;
  readonly used: number;
  readonly extra: boolean;
}

/** Names match whatever their case or spacing, so "Vijaki " and "vijaki" stay one line. */
export function materialKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** The planned materials in the manager's order, then anything the crew added. */
export function materialLines(order: { readonly materials: readonly Material[]; readonly materialUsage?: readonly MaterialUsage[] }): MaterialLine[] {
  const usage = order.materialUsage ?? [];
  const planned = order.materials.map((m) => {
    const key = materialKey(m.name);
    return { key, name: m.name, unit: m.unit, planned: m.qty, used: usage.find((u) => materialKey(u.name) === key)?.qty ?? 0, extra: false };
  });
  const known = new Set(planned.map((p) => p.key));
  const extra = usage.filter((u) => !known.has(materialKey(u.name))).map((u) => ({ key: materialKey(u.name), name: u.name, unit: u.unit, planned: null, used: u.qty, extra: true }));
  return [...planned, ...extra];
}

/** The running totals after one entry. Returns null when a correction would take a material below zero. */
export function applyMaterialUsage(usage: readonly MaterialUsage[], name: string, unit: string | null, delta: number): MaterialUsage[] | null {
  const key = materialKey(name);
  const current = usage.find((u) => materialKey(u.name) === key);
  const qty = Math.round(((current?.qty ?? 0) + delta) * 100) / 100;
  if (qty < 0) return null;
  const rest = usage.filter((u) => u !== current);
  return qty === 0 ? rest : [...rest, { name: current?.name ?? name.trim(), unit: current?.unit ?? unit, qty }];
}

export interface WorkOrder {
  readonly id: string;
  /** Server-issued number, e.g. `2026-00125`. Null until the server has accepted a new order. */
  readonly code: string | null;
  readonly title: string;
  readonly description: string;
  readonly projectId: string;
  readonly siteId: string;
  /** "Projekt · Objekt", denormalised for offline display. */
  readonly siteName: string;
  readonly location: string;
  readonly crew: readonly CrewMember[];
  readonly managerId: string;
  readonly managerName: string;
  readonly status: WorkOrderStatus;
  /** Drafts are invisible to workers; assigning publishes the order. */
  readonly published: boolean;
  readonly unit: QuantityUnit;
  /** 0 for a task without a quantity (an inspection, a handover): only time, notes, photos and the status count. */
  readonly plannedQty: number;
  readonly doneQty: number;
  readonly estimatedMinutes: number | null;
  /** The plan: what the crew should need. Amounts are optional. */
  readonly materials: readonly Material[];
  /** What the crew has used so far, across every day and worker. */
  readonly materialUsage: readonly MaterialUsage[];
  readonly date: IsoDate | null;
  readonly dueDate: IsoDate | null;
  readonly updatedAt: EpochMs;
}

/** Whether progress on this order is measured in a quantity; tasks without one are done when completed. */
export function hasQuantity(order: { readonly plannedQty: number }): boolean {
  return order.plannedQty > 0;
}

export type TimeEntryKind = 'SHIFT' | 'ORDER';

export interface TimeEntry {
  readonly id: string;
  readonly userId: string;
  readonly kind: TimeEntryKind;
  readonly workOrderId: string | null;
  /** The object the worker chose when starting the shift (SHIFT only; null when there was nothing to choose). */
  readonly siteId?: string | null;
  readonly date: IsoDate;
  readonly startedAt: EpochMs;
  readonly endedAt: EpochMs | null;
  /**
   * How the end was recorded. `TAP`: the worker pressed END at that moment.
   * `DECLARED`: the worker forgot to end and later stated the real end time; the manager sees it flagged.
   */
  readonly endSource?: 'TAP' | 'DECLARED';
  readonly endNote?: string | null;
}

export type LogEntryKind = 'QUANTITY' | 'MATERIAL' | 'NOTE' | 'ISSUE';

export interface LogEntry {
  readonly id: string;
  readonly userId: string;
  readonly workOrderId: string;
  readonly kind: LogEntryKind;
  /** Delta for QUANTITY entries in the order's unit, for MATERIAL entries in the material's unit. */
  readonly quantity: number | null;
  /** Which material a MATERIAL entry is about. */
  readonly materialName?: string | null;
  readonly materialUnit?: string | null;
  readonly text: string | null;
  readonly createdAt: EpochMs;
}

export interface PhotoMeta {
  readonly id: string;
  readonly userId: string;
  readonly workOrderId: string;
  readonly projectId: string;
  readonly category: PhotoCategory;
  readonly caption: string | null;
  readonly width: number;
  readonly height: number;
  readonly createdAt: EpochMs;
  /** Worker confirmed no identifiable faces or licence plates remain (after masking). */
  readonly privacyConfirmed: boolean;
  readonly maskCount: number;
}

export type DailySummaryStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED';

/** One work order inside a daily report. Time and quantity come from records; text is the worker's. */
export interface ReportOrderLine {
  readonly workOrderId: string;
  readonly code: string | null;
  readonly title: string;
  readonly siteName: string;
  readonly minutes: number;
  readonly quantity: number;
  readonly unit: QuantityUnit;
  readonly workDone: string;
  readonly materialsUsed: readonly Material[];
  readonly issues: readonly string[];
  readonly photoCount: number;
}

/** A worker's request to fix a recorded time. It never changes the record itself. */
export interface TimeCorrection {
  readonly field: 'ARRIVAL' | 'DEPARTURE';
  readonly recordedAt: EpochMs | null;
  readonly proposedAt: EpochMs;
  readonly reason: string;
}

export interface DailySummary {
  readonly id: string;
  readonly userId: string;
  readonly date: IsoDate;
  readonly arrivalAt: EpochMs | null;
  readonly departureAt: EpochMs | null;
  /** The object(s) chosen at ZAČNI DELO that day, "Projekt · Objekt"; null when none was chosen. */
  readonly siteName?: string | null;
  readonly shiftMinutes: number;
  readonly orderMinutes: number;
  readonly lines: readonly ReportOrderLine[];
  /** Order numbers worked, for lookups by order. */
  readonly ordersWorked: readonly string[];
  readonly issuesReported: number;
  readonly photosTaken: number;
  readonly declaredEnd: boolean;
  readonly corrections: readonly TimeCorrection[];
  readonly comment: string;
  readonly status: DailySummaryStatus;
  readonly submittedAt: EpochMs | null;
  readonly reviewedAt: EpochMs | null;
  readonly reviewerName: string | null;
  readonly reviewerNote: string | null;
}

export interface ConsentRecord {
  readonly userId: string;
  readonly version: string;
  readonly acceptedAt: EpochMs;
}

/**
 * Current version of the privacy notice shown on first login. It is the only notice in the app: it also covers
 * photos, so the camera opens without asking again. Bump when the legal copy changes; every user then
 * acknowledges the new notice once. (Acknowledgement of a notice, not consent.)
 */
export const CONSENT_VERSION = '2026-11-1';


/** Display label for an order number that the server has not issued yet. */
export function orderLabel(code: string | null, draftLabel: string): string {
  return code ?? draftLabel;
}
