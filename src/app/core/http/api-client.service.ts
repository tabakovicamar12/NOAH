import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  AdminUserCreate,
  AdminUserUpdate,
  AdminUsersResponse,
  AssignmentUpdate,
  ConsentRequest,
  DailySummaryUpsert,
  LogEntryCreate,
  LoginRequest,
  HoursResponse,
  LoginResponse,
  ManagerDirectoryResponse,
  ManagerOverviewResponse,
  ManagerProjectsResponse,
  OrgInfo,
  PasswordReset,
  PhotoUploadMeta,
  ProjectCreate,
  ProjectUpdate,
  SiteCreate,
  SiteUpdate,
  SummaryDetailResponse,
  SummaryReviewRequest,
  TimeEntryUpsert,
  WorkOrderDetailResponse,
  WorkOrderStatusRequest,
  WorkOrderUpsert,
  WorkerDayResponse,
  WorkerOrdersResponse,
} from '../models/api.models';
import type { DailySummary, IsoDate, Project, Site } from '../models/domain.models';

/**
 * Typed client for AON API v1. The only place that knows URLs.
 * All methods reject with ApiError (see resilienceInterceptor), never with raw HTTP errors.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  login(body: LoginRequest): Promise<LoginResponse> {
    return firstValueFrom(this.http.post<LoginResponse>(`${this.base}/auth/login`, body));
  }

  managerChanges(): Promise<{ readonly changedAt: number }> {
    return firstValueFrom(this.http.get<{ readonly changedAt: number }>(`${this.base}/manager/changes`));
  }

  org(): Promise<OrgInfo> {
    return firstValueFrom(this.http.get<OrgInfo>(`${this.base}/org`));
  }

  workerOrders(): Promise<WorkerOrdersResponse> {
    return firstValueFrom(this.http.get<WorkerOrdersResponse>(`${this.base}/worker/orders`));
  }

  workerDay(date: IsoDate, from: number): Promise<WorkerDayResponse> {
    const params = new HttpParams().set('date', date).set('from', String(from));
    return firstValueFrom(this.http.get<WorkerDayResponse>(`${this.base}/worker/day`, { params }));
  }

  workerSummary(date: IsoDate): Promise<DailySummary | null> {
    const params = new HttpParams().set('date', date);
    return firstValueFrom(this.http.get<DailySummary | null>(`${this.base}/worker/daily-summary`, { params }));
  }

  postConsent(body: ConsentRequest, opId: string): Promise<void> {
    return this.mutate('POST', `/consents`, body, opId);
  }

  upsertTimeEntry(body: TimeEntryUpsert, opId: string): Promise<void> {
    return this.mutate('PUT', `/time-entries/${encodeURIComponent(body.id)}`, body, opId);
  }

  setOrderStatus(workOrderId: string, body: WorkOrderStatusRequest, opId: string): Promise<void> {
    return this.mutate('POST', `/work-orders/${encodeURIComponent(workOrderId)}/status`, body, opId);
  }

  createLog(body: LogEntryCreate, opId: string): Promise<void> {
    return this.mutate('POST', `/logs`, body, opId);
  }

  /**
   * The bare JPEG as the body, the metadata in a header. No multipart: iOS Safari has sent form uploads of
   * stored photos without their content, and a plain body has nothing to get wrong.
   */
  uploadPhoto(meta: PhotoUploadMeta, file: Blob, opId: string): Promise<void> {
    const headers = new HttpHeaders({ 'Idempotency-Key': opId, 'Content-Type': 'image/jpeg', 'X-Photo-Meta': toBase64Url(JSON.stringify(meta)) });
    return firstValueFrom(this.http.post<void>(`${this.base}/photos`, file, { headers }));
  }

  /** The worker's own photo, while that day's report is open; `date` is the photo's day on this device. */
  deletePhoto(id: string, date: IsoDate): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/photos/${encodeURIComponent(id)}`, { params: new HttpParams().set('date', date) }));
  }

  upsertSummary(body: DailySummaryUpsert, opId: string): Promise<void> {
    return this.mutate('PUT', `/daily-summaries/${encodeURIComponent(body.id)}`, body, opId);
  }

  upsertOrder(body: WorkOrderUpsert, opId: string): Promise<void> {
    return this.mutate('PUT', `/manager/work-orders/${encodeURIComponent(body.id)}`, body, opId);
  }

  managerDirectory(): Promise<ManagerDirectoryResponse> {
    return firstValueFrom(this.http.get<ManagerDirectoryResponse>(`${this.base}/manager/directory`));
  }

  managerProjects(): Promise<ManagerProjectsResponse> {
    return firstValueFrom(this.http.get<ManagerProjectsResponse>(`${this.base}/manager/projects`));
  }

  createProject(body: ProjectCreate): Promise<Project> {
    return firstValueFrom(this.http.post<Project>(`${this.base}/manager/projects`, body));
  }

  createSite(body: SiteCreate): Promise<Site> {
    return firstValueFrom(this.http.post<Site>(`${this.base}/manager/sites`, body));
  }

  // ---- administrator

  adminUsers(): Promise<AdminUsersResponse> {
    return firstValueFrom(this.http.get<AdminUsersResponse>(`${this.base}/admin/users`));
  }

  createUser(body: AdminUserCreate): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>(`${this.base}/admin/users`, body));
  }

  updateUser(id: string, body: AdminUserUpdate): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`${this.base}/admin/users/${encodeURIComponent(id)}`, body));
  }

  resetPassword(id: string, body: PasswordReset): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.base}/admin/users/${encodeURIComponent(id)}/password`, body));
  }

  updateProject(id: string, body: ProjectUpdate): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`${this.base}/admin/projects/${encodeURIComponent(id)}`, body));
  }

  updateSite(id: string, body: SiteUpdate): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`${this.base}/admin/sites/${encodeURIComponent(id)}`, body));
  }

  /** Only when nothing was recorded on it; otherwise the server answers 409 HAS_RECORDS. */
  deleteProject(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/admin/projects/${encodeURIComponent(id)}`));
  }

  /** Only when nothing was recorded on it; otherwise the server answers 409 HAS_RECORDS. */
  deleteSite(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/admin/sites/${encodeURIComponent(id)}`));
  }

  /** Only when nobody has logged time, quantities, notes or photos on it; otherwise 409 HAS_RECORDS. */
  deleteWorkOrder(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/admin/work-orders/${encodeURIComponent(id)}`));
  }

  setProjectManagers(id: string, body: AssignmentUpdate): Promise<void> {
    return firstValueFrom(this.http.put<void>(`${this.base}/admin/projects/${encodeURIComponent(id)}/managers`, body));
  }

  setSiteForemen(id: string, body: AssignmentUpdate): Promise<void> {
    return firstValueFrom(this.http.put<void>(`${this.base}/admin/sites/${encodeURIComponent(id)}/foremen`, body));
  }

  summaryDetail(id: string): Promise<SummaryDetailResponse> {
    return firstValueFrom(this.http.get<SummaryDetailResponse>(`${this.base}/manager/daily-summaries/${encodeURIComponent(id)}`));
  }

  /** A month of working time: every worker in scope for the desk, or the signed-in worker. */
  hours(side: 'manager' | 'worker', month: string): Promise<HoursResponse> {
    return firstValueFrom(this.http.get<HoursResponse>(`${this.base}/${side}/hours`, { params: new HttpParams().set('month', month) }));
  }

  managerOverview(date: IsoDate): Promise<ManagerOverviewResponse> {
    // `from`: the day's local midnight on this device, so "that day" means the Slovenian day, not the server's.
    const params = new HttpParams().set('date', date).set('from', String(new Date(`${date}T00:00:00`).getTime()));
    return firstValueFrom(this.http.get<ManagerOverviewResponse>(`${this.base}/manager/overview`, { params }));
  }

  workOrderDetail(id: string): Promise<WorkOrderDetailResponse> {
    return firstValueFrom(
      this.http.get<WorkOrderDetailResponse>(`${this.base}/manager/work-orders/${encodeURIComponent(id)}`),
    );
  }

  reviewSummary(id: string, body: SummaryReviewRequest): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.base}/daily-summaries/${encodeURIComponent(id)}/review`, body),
    );
  }

  private mutate(method: 'POST' | 'PUT', path: string, body: unknown, opId: string): Promise<void> {
    const headers = new HttpHeaders({ 'Idempotency-Key': opId });
    return firstValueFrom(this.http.request<void>(method, `${this.base}${path}`, { body, headers }));
  }
}

/** UTF-8 safe base64url, for JSON in a header (captions may hold č, š, ž). */
function toBase64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
