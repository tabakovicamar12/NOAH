import type { Routes } from '@angular/router';
import { authGuard, consentGuard, guestGuard, homeRedirectGuard, roleGuard } from './core/auth/guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [homeRedirectGuard], children: [] },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
    title: 'AON · Prijava',
  },
  {
    path: 'consent',
    canActivate: [authGuard],
    loadComponent: () => import('./features/auth/consent.component').then((m) => m.ConsentComponent),
    title: 'AON · Zasebnost',
  },
  {
    path: 'privacy',
    loadComponent: () => import('./features/auth/privacy-policy.component').then((m) => m.PrivacyPolicyComponent),
    title: 'AON · Obvestilo o zasebnosti',
  },
  {
    path: 'w',
    canActivate: [authGuard, roleGuard('WORKER'), consentGuard],
    loadComponent: () => import('./features/worker/worker-shell.component').then((m) => m.WorkerShellComponent),
    loadChildren: () => import('./features/worker/worker.routes').then((m) => m.WORKER_ROUTES),
  },
  {
    path: 'm',
    canActivate: [authGuard, roleGuard('MANAGER'), consentGuard],
    loadComponent: () => import('./features/manager/manager-shell.component').then((m) => m.ManagerShellComponent),
    loadChildren: () => import('./features/manager/manager.routes').then((m) => m.MANAGER_ROUTES),
  },
  {
    path: '**',
    loadComponent: () => import('./features/not-found.component').then((m) => m.NotFoundComponent),
    title: 'AON',
  },
];
