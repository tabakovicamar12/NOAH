import type { Routes } from '@angular/router';

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
    path: 'orders/:id/edit',
    loadComponent: () => import('./order-form.component').then((m) => m.OrderFormComponent),
    title: 'AON · Uredi delovni nalog',
  },
  {
    path: 'report',
    loadComponent: () => import('./report.component').then((m) => m.ReportComponent),
    title: 'AON · Dnevno poročilo',
  },
];
