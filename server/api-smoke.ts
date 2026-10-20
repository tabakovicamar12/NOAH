/**
 * End-to-end check of the API against a throwaway PGlite database: numbering, units, quantity corrections,
 * permissions. Never touches Supabase (it refuses to run with DATABASE_URL set). Run: npm run test:api
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app';
import { hashPassword } from './auth';
import { loadConfig } from './config';
import { getDb } from './db';
import { migrate } from './migrations';
import { CONSENT_VERSION } from '../src/app/core/models/domain.models';

delete process.env['DATABASE_URL'];
delete process.env['SUPABASE_URL'];
delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
process.env['PGLITE_DIR'] = mkdtempSync(join(tmpdir(), 'aon-smoke-'));
process.env['LOCAL_PHOTO_DIR'] = mkdtempSync(join(tmpdir(), 'aon-smoke-photos-'));

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.databaseUrl) throw new Error('Refusing to run: a database URL is configured.');
  const db = await getDb(config);
  await migrate(db);
  const now = Date.now();
  await db.query(`insert into users (id, username, display_name, role, password_hash, active, created_at) values ('u-admin', 'admin', 'Admin', 'ADMIN', $1, true, $2)`, [await hashPassword('admin-geslo-123'), now]);
  await db.query(`insert into users (id, username, display_name, role, crew, password_hash, active, created_at) values ('u-w', 'delavec', 'Delavec', 'WORKER', 'A', $1, true, $2)`, [await hashPassword('delavec-geslo-123'), now]);
  const app = createApp(config);

  let failures = 0;
  const check = (name: string, ok: boolean, detail = ''): void => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
    if (!ok) failures++;
  };
  const call = async (method: string, path: string, token: string | null, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await app.request(`/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const admin = (await call('POST', '/auth/login', null, { username: 'admin', password: 'admin-geslo-123', role: 'MANAGER' })).body.token as string;
  const worker = (await call('POST', '/auth/login', null, { username: 'delavec', password: 'delavec-geslo-123', role: 'WORKER' })).body.token as string;
  check('logins', !!admin && !!worker);
  check('worker cannot use the desk door', (await call('POST', '/auth/login', null, { username: 'delavec', password: 'delavec-geslo-123', role: 'MANAGER' })).status !== 200);

  // Numbering
  const p1 = await call('POST', '/manager/projects', admin, { name: 'Hiša Novak' });
  const p2 = await call('POST', '/manager/projects', admin, { name: 'Vrtec' });
  const year = new Date().getFullYear();
  check('project numbers are issued', p1.body?.code === `P-${year}-001` && p2.body?.code === `P-${year}-002`, `${p1.body?.code} ${p2.body?.code}`);
  const s1 = await call('POST', '/manager/sites', admin, { projectId: p1.body.id, name: 'Objekt A', city: 'Maribor' });
  const s2 = await call('POST', '/manager/sites', admin, { projectId: p1.body.id, name: 'Objekt B', city: '' });
  check('object numbers are issued per project', s1.body?.code === 'O-1' && s2.body?.code === 'O-2', `${s1.body?.code} ${s2.body?.code}`);
  check('a worker cannot create projects', (await call('POST', '/manager/projects', worker, { name: 'X' })).status === 403);

  // Objects from the house catalogue, or named by hand
  const house = await call('POST', '/manager/sites', admin, { projectId: p2.body.id, name: 'KLASIK 115', city: 'Celje', houseModel: 'klasik-115' });
  check('an object can be a catalogue house', house.status === 201 && house.body?.houseModel === 'klasik-115', JSON.stringify(house.body));
  check('an unknown house is refused', (await call('POST', '/manager/sites', admin, { projectId: p2.body.id, name: 'X', city: '', houseModel: 'castle-1' })).status === 400);
  check('a hand-named object has no house', s2.body?.houseModel === null, String(s2.body?.houseModel));
  await call('PATCH', `/admin/sites/${house.body.id}`, admin, { houseModel: 'duo-190' });
  const listed = (await call('GET', '/manager/projects', admin)).body;
  const changed = JSON.stringify(listed).includes('"houseModel":"duo-190"');
  check('the house can be changed later', changed);

  const newOrder = async (unit: string, plannedQty: number, title: string): Promise<{ id: string; status: number; code?: string }> => {
    const id = crypto.randomUUID();
    const r = await call('PUT', `/manager/work-orders/${id}`, admin, {
      id, title, description: '', siteId: s1.body.id, location: '', crewIds: ['u-w'], unit, plannedQty,
      estimatedMinutes: null, materials: [], date: null, dueDate: null, published: true, savedAt: Date.now(),
    });
    const d = await call('GET', `/manager/work-orders/${id}`, admin);
    return { id, status: r.status, code: d.body?.order?.code };
  };
  const o1 = await newOrder('PCS', 4, 'Montaža panelov');
  const o2 = await newOrder('KG', 250, 'Armatura');
  const o3 = await newOrder('KPL', 2, 'Okna');
  check('order numbers are issued in sequence', o1.code === `${year}-001` && o2.code === `${year}-002` && o3.code === `${year}-003`, `${o1.code} ${o2.code} ${o3.code}`);
  check('kg and kpl units are accepted', o2.status === 204 && o3.status === 204);
  const bad = await newOrder('BOX', 1, 'X');
  check('an unknown unit is rejected', bad.status === 400);

  // Quantities and corrections
  const log = (orderId: string, quantity: number, text: string | null): Promise<{ status: number }> =>
    call('POST', '/logs', worker, { id: crypto.randomUUID(), userId: 'u-w', workOrderId: orderId, kind: 'QUANTITY', quantity, text, createdAt: Date.now() });
  check('a quantity can be logged', (await log(o1.id, 5, null)).status === 204);
  check('a correction without a reason is rejected', (await log(o1.id, -4, null)).status === 400);
  check('a correction with a reason is accepted', (await log(o1.id, -4, 'Pomotoma +5 namesto +1')).status === 204);
  check('a correction below zero is rejected', (await log(o1.id, -5, 'preveč')).status === 409);
  const after = await call('GET', `/manager/work-orders/${o1.id}`, admin);
  check('the total reflects the correction', after.body?.order?.doneQty === 1, String(after.body?.order?.doneQty));
  check('both entries stay in the history', (after.body?.logs ?? []).filter((l: { kind: string }) => l.kind === 'QUANTITY').length === 2);

  // Working time
  const hours = await call('GET', `/worker/hours?month=${year}-01`, worker);
  check('a worker reads their own hours', hours.status === 200 && hours.body?.workers?.length === 1);
  check('a worker cannot read the desk hours', (await call('GET', `/manager/hours?month=${year}-01`, worker)).status === 403);
  check('a bad month is rejected', (await call('GET', '/manager/hours?month=2026-13', admin)).status === 400);

  // One day on two phones: the report counts both, whatever the submitting phone believed.
  const day = `${year}-02-03`;
  const at = (h: number, m = 0): number => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
  const entry = (kind: 'SHIFT' | 'ORDER', start: number, end: number | null): Promise<{ status: number }> => {
    const id = crypto.randomUUID();
    return call('PUT', `/time-entries/${id}`, worker, { id, userId: 'u-w', kind, workOrderId: kind === 'ORDER' ? o1.id : null, date: day, startedAt: start, endedAt: end });
  };
  await entry('SHIFT', at(7), at(11)); // phone A
  await entry('ORDER', at(7, 10), at(10, 40));
  await entry('SHIFT', at(12), at(15, 30)); // phone B
  const both = await call('GET', `/worker/day?date=${day}&from=${at(0)}`, worker);
  check('the day returns entries from every device', both.status === 200 && both.body?.timeEntries?.length === 3, String(both.body?.timeEntries?.length));
  const sumId = `sum-u-w-${day}`;
  const report = {
    id: sumId, userId: 'u-w', date: day, arrivalAt: at(12), departureAt: at(15, 30), shiftMinutes: 210, orderMinutes: 0,
    lines: [{ workOrderId: o1.id, code: null, title: '', siteName: '', minutes: 0, quantity: 0, unit: 'PCS', workDone: '', materialsUsed: [], issues: [], photoCount: 0 }],
    ordersWorked: [], issuesReported: 0, photosTaken: 0, declaredEnd: false, corrections: [], comment: '', status: 'SUBMITTED', submittedAt: at(15, 31),
    reviewedAt: null, reviewerName: null, reviewerNote: null,
  };
  await call('PUT', `/daily-summaries/${sumId}`, worker, report);
  const saved = (await call('GET', `/worker/daily-summary?date=${day}`, worker)).body;
  check('the report counts both phones', saved?.shiftMinutes === 450 && saved?.arrivalAt === at(7) && saved?.departureAt === at(15, 30), `${saved?.shiftMinutes}`);
  check('order time in the report comes from the records', saved?.orderMinutes === 210 && saved?.lines?.[0]?.minutes === 210, `${saved?.orderMinutes}`);
  await entry('SHIFT', at(18), null);
  check('a report with an open shift is refused', (await call('PUT', `/daily-summaries/${sumId}`, worker, report)).status === 409);

  // A past day lists only the orders that concern it
  const pastDay = (await call('GET', `/manager/overview?date=${day}&from=${at(0)}`, admin)).body;
  const flag = (id: string): boolean | undefined => pastDay?.orders?.find((r: { order: { id: string }; activeOnDate: boolean }) => r.order.id === id)?.activeOnDate;
  check('an order worked on that day is active on it', flag(o1.id) === true, String(flag(o1.id)));
  check('an order untouched that day is not', flag(o3.id) === false, String(flag(o3.id)));

  // ZAČNI DELO on a chosen object
  const workerOrders = await call('GET', '/worker/orders', worker);
  check('the worker gets the objects to choose from', (workerOrders.body?.sites ?? []).some((s: { id: string }) => s.id === s1.body.id));
  const day2 = `${year}-02-04`;
  const at2 = (h: number): number => new Date(`${day2}T${String(h).padStart(2, '0')}:00:00`).getTime();
  const shiftId = crypto.randomUUID();
  const shift = { id: shiftId, userId: 'u-w', kind: 'SHIFT', workOrderId: null, siteId: s1.body.id, date: day2, startedAt: at2(7), endedAt: null };
  check('a shift starts on the chosen object', (await call('PUT', `/time-entries/${shiftId}`, worker, shift)).status === 204);
  const unknownSite = crypto.randomUUID();
  check('an unknown object is refused', (await call('PUT', `/time-entries/${unknownSite}`, worker, { ...shift, id: unknownSite, siteId: 's-nope' })).status === 404);
  await call('PUT', `/time-entries/${shiftId}`, worker, { ...shift, endedAt: at2(15) });
  const day2Entries = (await call('GET', `/worker/day?date=${day2}&from=${at2(0)}`, worker)).body?.timeEntries ?? [];
  check('the shift keeps its object', day2Entries.some((e: { id: string; siteId: string | null }) => e.id === shiftId && e.siteId === s1.body.id));
  const sum2 = `sum-u-w-${day2}`;
  await call('PUT', `/daily-summaries/${sum2}`, worker, { ...report, id: sum2, date: day2, lines: [] });
  const saved2 = (await call('GET', `/worker/daily-summary?date=${day2}`, worker)).body;
  check('the daily report names the object', saved2?.siteName === 'Hiša Novak · Objekt A', String(saved2?.siteName));

  // The privacy notice is acknowledged once per account, not once per device
  const freshLogin = await call('POST', '/auth/login', null, { username: 'delavec', password: 'delavec-geslo-123', role: 'WORKER' });
  check('before acknowledging, login reports no notice', freshLogin.body?.consents?.notice === null);
  await call('POST', '/consents', worker, { version: CONSENT_VERSION, acceptedAt: Date.now() });
  const again = await call('POST', '/auth/login', null, { username: 'delavec', password: 'delavec-geslo-123', role: 'WORKER' });
  check('another device learns the notice was acknowledged', again.body?.consents?.notice?.version === CONSENT_VERSION);
  // Photos: the bare JPEG with metadata in a header; the old multipart form still works; a broken form is a 400
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(2000).fill(7), 0xff, 0xd9]);
  const photoMeta = (id: string) => ({
    id, userId: 'u-w', workOrderId: o1.id, projectId: '', category: 'IN_PROGRESS', caption: 'Stena č. 6 – šivi', width: 10, height: 10,
    createdAt: Date.now(), privacyConfirmed: true, maskCount: 0,
  });
  const rawId = crypto.randomUUID();
  const raw = await app.request('/api/v1/photos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${worker}`, 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'image/jpeg',
      'X-Photo-Meta': Buffer.from(JSON.stringify(photoMeta(rawId))).toString('base64url'),
    },
    body: jpeg,
  });
  check('a bare JPEG upload is stored', raw.status === 204, String(raw.status));
  const form = new FormData();
  form.append('meta', JSON.stringify(photoMeta(crypto.randomUUID())));
  form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'x.jpg');
  const multi = await app.request('/api/v1/photos', { method: 'POST', headers: { Authorization: `Bearer ${worker}`, 'Idempotency-Key': crypto.randomUUID() }, body: form });
  check('the old multipart upload still works', multi.status === 204, String(multi.status));
  const broken = await app.request('/api/v1/photos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${worker}`, 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'multipart/form-data; boundary=x' },
    body: 'nothing here',
  });
  check('an unreadable form is a 400, not a server error', broken.status === 400, String(broken.status));
  const detail = await call('GET', `/manager/work-orders/${o1.id}`, admin);
  check('the photo and its Slovenian caption arrive intact', (detail.body?.photos ?? []).some((ph: { id: string; caption: string }) => ph.id === rawId && ph.caption === 'Stena č. 6 – šivi'));

  // The desk's cheap "anything new?" moves with every recorded entry
  const before = (await call('GET', '/manager/changes', admin)).body?.changedAt ?? 0;
  await log(o2.id, 1, null);
  const after2 = (await call('GET', '/manager/changes', admin)).body?.changedAt ?? 0;
  check('a worker entry moves the change marker', after2 > before, `${before} -> ${after2}`);
  check('workers cannot read the change marker', (await call('GET', '/manager/changes', worker)).status === 403);

  const org = await call('GET', '/org', null);
  check('employer details are public', org.status === 200 && 'name' in (org.body ?? {}));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
