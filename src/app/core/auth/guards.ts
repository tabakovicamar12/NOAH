import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { isAdmin, isDeskRole, type Role } from '../models/domain.models';
import { ConsentService } from './consent.service';
import { SessionStore } from './session.store';

export function homeFor(role: Role | null): string {
  return isDeskRole(role) ? '/m' : role === 'WORKER' ? '/w' : '/login';
}

export const authGuard: CanActivateFn = (): boolean | UrlTree => {
  const session = inject(SessionStore);
  return session.session() ? true : inject(Router).createUrlTree(['/login']);
};

/** The field app: workers only. */
export const workerGuard: CanActivateFn = (): boolean | UrlTree => {
  const current = inject(SessionStore).role();
  return current === 'WORKER' ? true : inject(Router).createUrlTree([homeFor(current)]);
};

/** The desk: administrators, managers and foremen. The server narrows each to their own scope. */
export const deskGuard: CanActivateFn = (): boolean | UrlTree => {
  const current = inject(SessionStore).role();
  return isDeskRole(current) ? true : inject(Router).createUrlTree([homeFor(current)]);
};

/** Account administration. */
export const adminGuard: CanActivateFn = (): boolean | UrlTree => {
  const current = inject(SessionStore).role();
  return isAdmin(current) ? true : inject(Router).createUrlTree([homeFor(current)]);
};

/** First login on a device (or a new notice version) must pass the consent modal. */
export const consentGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const user = inject(SessionStore).user();
  const router = inject(Router);
  if (!user) return router.createUrlTree(['/login']);
  return (await inject(ConsentService).hasConsent(user.id)) ? true : router.createUrlTree(['/consent']);
};

export const homeRedirectGuard: CanActivateFn = (): UrlTree => inject(Router).createUrlTree([homeFor(inject(SessionStore).role())]);

export const guestGuard: CanActivateFn = (): boolean | UrlTree => {
  const role = inject(SessionStore).role();
  return role ? inject(Router).createUrlTree([homeFor(role)]) : true;
};
