import type { DailySummary } from '../src/app/core/models/domain.models';
import type { Db } from './db';
import type { UserRow } from './rows';

/**
 * What a desk user may see and change. The administrator sees everything; a manager the projects they lead
 * (with every object in them); a foreman the objects they lead. Workers have no desk scope: their access runs
 * through the crews of their orders.
 */
export interface Scope {
  readonly all: boolean;
  readonly projectIds: readonly string[];
  readonly siteIds: readonly string[];
}

const NONE: Scope = { all: false, projectIds: [], siteIds: [] };

export async function scopeOf(db: Db, me: UserRow): Promise<Scope> {
  if (me.role === 'ADMIN') return { all: true, projectIds: [], siteIds: [] };
  if (me.role === 'MANAGER') {
    const rows = await db.query(
      `select pm.project_id, s.id as site_id from project_managers pm left join sites s on s.project_id = pm.project_id where pm.user_id = $1`,
      [me.id],
    );
    return {
      all: false,
      projectIds: [...new Set(rows.map((r) => String(r['project_id'])))],
      siteIds: [...new Set(rows.filter((r) => r['site_id'] != null).map((r) => String(r['site_id'])))],
    };
  }
  if (me.role === 'FOREMAN') {
    const rows = await db.query(`select sf.site_id, s.project_id from site_foremen sf join sites s on s.id = sf.site_id where sf.user_id = $1`, [me.id]);
    return {
      all: false,
      projectIds: [...new Set(rows.map((r) => String(r['project_id'])))],
      siteIds: [...new Set(rows.map((r) => String(r['site_id'])))],
    };
  }
  return NONE;
}

export function siteInScope(scope: Scope, siteId: string): boolean {
  return scope.all || scope.siteIds.includes(siteId);
}

export function projectInScope(scope: Scope, projectId: string): boolean {
  return scope.all || scope.projectIds.includes(projectId);
}

/**
 * A daily report is in scope when one of its order lines ran on an object in scope, or, for a report without
 * lines, when the worker is on the crew of an order in scope. A manager may therefore see a whole report that
 * also covers another project: the report is one signed record per worker and day.
 */
export async function summaryInScope(db: Db, scope: Scope, summary: DailySummary): Promise<boolean> {
  if (scope.all) return true;
  if (scope.siteIds.length === 0) return false;
  const orderIds = summary.lines.map((l) => l.workOrderId).filter((id) => typeof id === 'string');
  if (orderIds.length > 0) {
    const hit = await db.query(`select 1 from work_orders where id = any($1::text[]) and site_id = any($2::text[]) limit 1`, [orderIds, [...scope.siteIds]]);
    if (hit.length > 0) return true;
  }
  const crew = await db.query(
    `select 1 from work_order_crew c join work_orders o on o.id = c.order_id where c.user_id = $1 and o.site_id = any($2::text[]) limit 1`,
    [summary.userId, [...scope.siteIds]],
  );
  return crew.length > 0;
}
