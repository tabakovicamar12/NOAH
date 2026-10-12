import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  ConsentRequest,
  DailySummaryUpsert,
  LogEntryCreate,
  LoginRequest,
  LoginResponse,
  ManagerDirectoryResponse,
  ManagerOverviewResponse,
  ManagerProjectsResponse,
  PhotoUploadMeta,
  ProjectCreate,
  SiteCreate,
  SummaryDetailResponse,
  SummaryReviewRequest,
  TimeEntryUpsert,
  WorkOrderDetailResponse,
  WorkOrderStatusRequest,
  WorkOrderUpsert,
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

  workerOrders(): Promise<WorkerOrdersResponse> {
    return firstValueFrom(this.http.get<WorkerOrdersResponse>(`${this.base}/worker/orders`));
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

  uploadPhoto(meta: PhotoUploadMeta, file: Blob, opId: string): Promise<void> {
    const form = new FormData();
    form.append('meta', JSON.stringify(meta));
    form.append('file', file, `${meta.id}.jpg`);
    return this.mutate('POST', `/photos`, form, opId);
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

  summaryDetail(id: string): Promise<SummaryDetailResponse> {
    return firstValueFrom(this.http.get<SummaryDetailResponse>(`${this.base}/manager/daily-summaries/${encodeURIComponent(id)}`));
  }

  managerOverview(date: IsoDate): Promise<ManagerOverviewResponse> {
    const params = new HttpParams().set('date', date);
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
