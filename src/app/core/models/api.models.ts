/**
 * AON HTTP API contract (v1). The mock backend implements exactly this; a real server must too.
 * Base path: `${environment.apiBaseUrl}` (default `/api/v1`).
 *
 * Every mutating request carries `Idempotency-Key: <opId>` so the sync engine can replay safely.
 */
import type {
  CrewMember,
  DailySummary,
  IsoDate,
  LogEntry,
  Material,
  PhotoCategory,
  PhotoMeta,
  Project,
  QuantityUnit,
  Role,
  Site,
  TimeEntry,
  User,
  WorkOrder,
  WorkOrderStatus,
} from './domain.models';

/**
 * The login screen's two doors: the field app (WORKER) or the desk (MANAGER, which admits administrators,
 * managers and foremen). The server answers ROLE_MISMATCH when the account belongs to the other door.
 */
export type LoginSide = 'WORKER' | 'MANAGER';

// POST /auth/login
export interface LoginRequest {
  readonly username: string;
  readonly password: string;
  readonly role: LoginSide;
}
export interface LoginResponse {
  readonly token: string;
  readonly expiresAt: number;
  readonly user: User;
  /**
   * What this account already acknowledged or consented to, from any device, so a new phone or a cleared
   * browser does not ask again. Each entry is the newest record of its kind.
   */
  readonly consents?: LoginConsents;
}
export interface LoginConsents {
  /** Version of the privacy notice acknowledged, if it is the current one. */
  readonly notice: { readonly version: string; readonly acceptedAt: number } | null;
  /** Newest voice-input decision (a version ending in `:withdrawn` is a withdrawal). */
  readonly voice: { readonly version: string; readonly acceptedAt: number } | null;
}

// GET /org  (public: the employer that runs this installation, for the privacy notice and printed reports)
export interface OrgInfo {
  /** Company name, e.g. "NOAH d.o.o."; null until the installation is configured. */
  readonly name: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
  /** Where workers send privacy requests. */
  readonly privacyContact: string | null;
  /** Data protection officer, when one is appointed. */
  readonly dpo: string | null;
  /** How long photos are kept, in days; null when they are not deleted automatically. */
  readonly photoRetentionDays: number | null;
}

// GET /health
export interface HealthResponse {
  readonly ok: true;
  readonly serverTime: number;
}

// GET /worker/orders  (published orders where the caller is in the crew)
export interface WorkerOrdersResponse {
  readonly orders: readonly WorkOrder[];
  /** Active objects the worker can choose at ZAČNI DELO. */
  readonly sites?: readonly Site[];
  readonly serverTime: number;
}

// GET /worker/day?date=&from=  (the caller's own records of one day, from every device)
export interface WorkerDayResponse {
  /** Entries of that date, plus any entry still open from an earlier day. */
  readonly timeEntries: readonly TimeEntry[];
  /** Log entries created from `from` (local midnight) for 26 hours. */
  readonly logs: readonly LogEntry[];
}

// POST /consents
export interface ConsentRequest {
  readonly version: string;
  readonly acceptedAt: number;
}

// PUT /time-entries/:id
export type TimeEntryUpsert = TimeEntry;

// POST /work-orders/:id/status
export interface WorkOrderStatusRequest {
  readonly status: WorkOrderStatus;
  readonly changedAt: number;
}

// POST /logs
export type LogEntryCreate = LogEntry;

// POST /photos  (multipart: `meta` JSON + `file` JPEG)
export type PhotoUploadMeta = PhotoMeta;

// PUT /daily-summaries/:id
export type DailySummaryUpsert = DailySummary;

// ---------- Manager ----------

/**
 * PUT /manager/work-orders/:id  (create or update; the server issues `code` on first save).
 * Crew members who already logged time on the order cannot be removed (409).
 */
export interface WorkOrderUpsert {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly siteId: string;
  readonly location: string;
  readonly crewIds: readonly string[];
  readonly published: boolean;
  readonly unit: QuantityUnit;
  readonly plannedQty: number;
  readonly estimatedMinutes: number | null;
  readonly materials: readonly Material[];
  readonly date: IsoDate | null;
  readonly dueDate: IsoDate | null;
  readonly savedAt: number;
}

export interface DirectoryWorker {
  readonly user: User;
  /** Published orders in NEW / IN_PROGRESS / ISSUE that include this worker. */
  readonly openOrders: number;
}

// GET /manager/directory
export interface ManagerDirectoryResponse {
  readonly projects: readonly Project[];
  readonly sites: readonly Site[];
  readonly workers: readonly DirectoryWorker[];
  readonly serverTime: number;
}

/** One order line in the projects list. */
export interface ProjectOrderRow {
  readonly id: string;
  readonly code: string | null;
  readonly title: string;
  readonly siteId: string;
  readonly status: WorkOrderStatus;
  readonly published: boolean;
  readonly crewNames: readonly string[];
  readonly doneQty: number;
  readonly plannedQty: number;
  readonly unit: QuantityUnit;
  readonly minutesTotal: number;
  readonly dueDate: IsoDate | null;
  readonly openIssues: number;
}

export interface ProjectSummary {
  readonly project: Project;
  readonly sites: readonly Site[];
  readonly orders: readonly ProjectOrderRow[];
  /** Managers assigned to the project. */
  readonly managers: readonly CrewMember[];
  /** Foremen assigned to each object, keyed by site id. */
  readonly foremen: Readonly<Record<string, readonly CrewMember[]>>;
}

// POST /manager/projects  (administrator; 409 when the code is taken)
export interface ProjectCreate {
  /** Leave out to get the next number (P-2026-001). */
  readonly code?: string;
  readonly name: string;
}

// POST /manager/sites  (administrator; 409 when the project already has this code)
export interface SiteCreate {
  readonly projectId: string;
  /** Leave out to get the next object number in the project (O-1, O-2 …). */
  readonly code?: string;
  readonly name: string;
  readonly city: string;
  /** Catalogue house id, or null for an object named by hand. */
  readonly houseModel?: string | null;
}

// GET /manager/projects  (scoped: administrator all, manager their projects, foreman their objects)
export interface ManagerProjectsResponse {
  readonly projects: readonly ProjectSummary[];
  readonly serverTime: number;
}

// ---------- Administrator ----------

// PATCH /admin/projects/:id  (archiving hides the project and its objects; records stay)
export interface ProjectUpdate {
  readonly name?: string;
  readonly active?: boolean;
}

// PATCH /admin/sites/:id
export interface SiteUpdate {
  readonly name?: string;
  readonly city?: string;
  readonly houseModel?: string | null;
  readonly active?: boolean;
}

// PUT /admin/projects/:id/managers (MANAGER accounts) · PUT /admin/sites/:id/foremen (FOREMAN accounts)
export interface AssignmentUpdate {
  readonly userIds: readonly string[];
}

export interface AdminUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: Role;
  readonly crew: string | null;
  readonly active: boolean;
  /** Projects a manager leads, or the projects of the objects a foreman leads. */
  readonly projects: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  /** Objects a foreman leads. */
  readonly sites: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  /** Published, unfinished orders this worker is on. */
  readonly openOrders: number;
}

// GET /admin/users
export interface AdminUsersResponse {
  readonly users: readonly AdminUser[];
}

// POST /admin/users  (409 USERNAME_TAKEN)
export interface AdminUserCreate {
  readonly username: string;
  readonly displayName: string;
  readonly role: Role;
  readonly crew: string | null;
  readonly password: string;
}

/**
 * PATCH /admin/users/:id. Refused with 409: changing your own role or deactivating yourself (SELF_LOCKOUT),
 * leaving no active administrator (LAST_ADMIN), moving a worker who is still on open orders (OPEN_ORDERS).
 */
export interface AdminUserUpdate {
  readonly displayName?: string;
  readonly role?: Role;
  readonly crew?: string | null;
  readonly active?: boolean;
}

// POST /admin/users/:id/password
export interface PasswordReset {
  readonly password: string;
}

export type WorkerPresence = 'WORKING' | 'NOT_STARTED' | 'FINISHED';

export interface WorkerOverview {
  readonly user: User;
  readonly presence: WorkerPresence;
  readonly site: Site | null;
  readonly activeOrderCode: string | null;
  readonly shiftStartedAt: number | null;
  /** When the day's last shift ended; null while a shift is still running or none was started. */
  readonly shiftEndedAt: number | null;
  readonly minutesToday: number;
  readonly summaryId: string | null;
  readonly summaryStatus: DailySummary['status'] | null;
}

export interface OrderOverview {
  readonly order: WorkOrder;
  readonly minutesToday: number;
  readonly minutesTotal: number;
  readonly photoCount: number;
  readonly openIssues: number;
  /**
   * The order concerns the requested day: time, a quantity, a note, a problem or a photo was recorded on it
   * that day, or the day is its planned start or deadline. The desk lists only these for a day in the past.
   */
  readonly activeOnDate: boolean;
}

export interface ManagerOverviewResponse {
  readonly date: IsoDate;
  readonly projects: readonly Project[];
  readonly sites: readonly Site[];
  readonly workers: readonly WorkerOverview[];
  readonly orders: readonly OrderOverview[];
  readonly summaries: readonly DailySummary[];
  readonly serverTime: number;
}

/** A work order as the hours record names it. */
export interface HoursOrderRef {
  readonly id: string;
  readonly code: string | null;
  readonly title: string;
  readonly siteId: string;
}

/**
 * Working time for one month: every shift from just before the year's start to the end of the month (yearly
 * overtime and rest need the run-up), the order segments inside the month, and each day's report status.
 * Desk users get the workers in their scope; a worker gets only themself.
 */
export interface HoursResponse {
  readonly month: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly workers: readonly User[];
  readonly shifts: readonly TimeEntry[];
  readonly segments: readonly TimeEntry[];
  readonly orders: readonly HoursOrderRef[];
  readonly sites: readonly Site[];
  readonly summaries: ReadonlyArray<Pick<DailySummary, 'id' | 'userId' | 'date' | 'status'>>;
  readonly serverTime: number;
}

export interface PhotoView extends PhotoMeta {
  /** Absolute or object URL; null when the binary is not available. */
  readonly url: string | null;
  readonly userName: string;
}

export interface WorkOrderDetailResponse {
  readonly order: WorkOrder;
  /** Crew members with recorded time: they stay on the order. */
  readonly lockedCrewIds: readonly string[];
  readonly timeEntries: readonly TimeEntry[];
  readonly logs: readonly LogEntry[];
  readonly photos: readonly PhotoView[];
  readonly summaries: readonly DailySummary[];
}

// GET /manager/daily-summaries/:id
export interface SummaryDetailResponse {
  readonly summary: DailySummary;
  readonly worker: User;
  readonly photos: readonly PhotoView[];
}

// POST /daily-summaries/:id/review  (a return must carry a note)
export interface SummaryReviewRequest {
  readonly decision: 'APPROVED' | 'RETURNED';
  readonly note: string | null;
}

export interface PhotoCategoryCount {
  readonly category: PhotoCategory;
  readonly count: number;
}

/** Normalised error every API failure is mapped to by the error interceptor. */
/**
 * UNAUTHORIZED (401): the session is gone, log in again. FORBIDDEN (403): this one request is not allowed
 * (another crew's order, out of scope); the session is fine and everything else keeps syncing.
 */
export type ApiErrorKind = 'NETWORK' | 'TIMEOUT' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'VALIDATION' | 'CONFLICT' | 'NOT_FOUND' | 'SERVER';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Transient errors are retried by the sync engine; permanent ones move the operation to the failed list. */
  get transient(): boolean {
    return this.kind === 'NETWORK' || this.kind === 'TIMEOUT' || this.kind === 'SERVER';
  }
}
