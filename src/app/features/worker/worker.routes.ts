import type { Routes } from '@angular/router';

export const WORKER_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'orders' },
  {
    path: 'orders',
    loadComponent: () => import('./orders.component').then((m) => m.OrdersComponent),
    title: 'AON · Nalogi',
  },
  {
    path: 'orders/:id',
    loadComponent: () => import('./order-detail.component').then((m) => m.OrderDetailComponent),
    title: 'AON · Nalog',
  },
  {
    path: 'day',
    loadComponent: () => import('./day-report.component').then((m) => m.DayReportComponent),
    title: 'AON · Dnevno poročilo',
  },
  {
    path: 'hours',
    loadComponent: () => import('../../shared/worktime/work-record-page.component').then((m) => m.WorkRecordPageComponent),
    data: { side: 'worker' },
    title: 'AON · Moje ure',
  },
  {
    path: 'more',
    loadComponent: () => import('./more.component').then((m) => m.MoreComponent),
    title: 'AON · Več',
  },
];
