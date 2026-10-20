import type { Routes } from '@angular/router';
import { adminGuard } from '../../core/auth/guards';

export const MANAGER_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./overview.component').then((m) => m.OverviewComponent),
    title: 'AON · Pregled',
  },
  {
    path: 'projects',
    loadComponent: () => import('./projects.component').then((m) => m.ProjectsComponent),
    title: 'AON · Projekti',
  },
  {
    path: 'orders/new',
    loadComponent: () => import('./order-form.component').then((m) => m.OrderFormComponent),
    title: 'AON · Nov delovni nalog',
  },
  {
    path: 'orders/:id',
    loadComponent: () => import('./order-page.component').then((m) => m.OrderPageComponent),
    title: 'AON · Delovni nalog',
  },
  {
    path: 'orders/:id/edit',
    loadComponent: () => import('./order-form.component').then((m) => m.OrderFormComponent),
    title: 'AON · Uredi delovni nalog',
  },
  {
    path: 'hours',
    loadComponent: () => import('./hours.component').then((m) => m.HoursComponent),
    title: 'AON · Delovni čas',
  },
  {
    path: 'hours/:userId',
    loadComponent: () => import('../../shared/worktime/work-record-page.component').then((m) => m.WorkRecordPageComponent),
    data: { side: 'manager' },
    title: 'AON · Evidenca delovnega časa',
  },
  {
    path: 'people',
    canActivate: [adminGuard],
    loadComponent: () => import('./people.component').then((m) => m.PeopleComponent),
    title: 'AON · Uporabniki',
  },
  {
    path: 'reports/:id',
    loadComponent: () => import('./daily-report-sheet.component').then((m) => m.DailyReportSheetComponent),
    title: 'AON · Dnevno poročilo delavca',
  },
  {
    path: 'report',
    loadComponent: () => import('./report.component').then((m) => m.ReportComponent),
    title: 'AON · Dnevno poročilo',
  },
];
