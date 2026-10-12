/**
 * AON HTTP API contract (v1). The mock backend implements exactly this; a real server must too.
 * Base path: `${environment.apiBaseUrl}` (default `/api/v1`).
 *
 * Every mutating request carries `Idempotency-Key: <opId>` so the sync engine can replay safely.
 */
import type {
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

// POST /auth/login
export interface LoginRequest {
  readonly username: string;
  readonly password: string;
  readonly role: Role;
}
export interface LoginResponse {
  readonly token: string;
  readonly expiresAt: number;
  readonly user: User;
}

// GET /health
export interface HealthResponse {
  readonly ok: true;
  readonly serverTime: number;
}

// GET /worker/orders  (published orders where the caller is in the crew)
export interface WorkerOrdersResponse {
  readonly orders: readonly WorkOrder[];
  readonly serverTime: number;
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
}

// POST /manager/projects  (managers with canManageProjects; 409 when the code is taken)
export interface ProjectCreate {
  readonly code: string;
  readonly name: string;
}

// POST /manager/sites  (managers with canManageProjects; 409 when the project already has this code)
export interface SiteCreate {
  readonly projectId: string;
  readonly code: string;
  readonly name: string;
  readonly city: string;
}

// GET /manager/projects
export interface ManagerProjectsResponse {
  readonly projects: readonly ProjectSummary[];
  readonly serverTime: number;
}

export type WorkerPresence = 'WORKING' | 'NOT_STARTED' | 'FINISHED';

export interface WorkerOverview {
  readonly user: User;
  readonly presence: WorkerPresence;
  readonly site: Site | null;
  readonly activeOrderCode: string | null;
  readonly shiftStartedAt: number | null;
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
export type ApiErrorKind = 'NETWORK' | 'TIMEOUT' | 'UNAUTHORIZED' | 'VALIDATION' | 'CONFLICT' | 'NOT_FOUND' | 'SERVER';

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
