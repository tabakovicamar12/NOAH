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
  readonly materials: readonly Material[];
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

export type LogEntryKind = 'QUANTITY' | 'NOTE' | 'ISSUE';

export interface LogEntry {
  readonly id: string;
  readonly userId: string;
  readonly workOrderId: string;
  readonly kind: LogEntryKind;
  /** Quantity delta for QUANTITY entries, in the order's unit. */
  readonly quantity: number | null;
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
 * Current version of the privacy notice shown on first login. Bump when the legal copy changes; every user
 * then acknowledges the new notice once. (Acknowledgement of a notice, not consent.)
 */
export const CONSENT_VERSION = '2026-10-2';


/** Display label for an order number that the server has not issued yet. */
export function orderLabel(code: string | null, draftLabel: string): string {
  return code ?? draftLabel;
}
