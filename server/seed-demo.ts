import type { Role } from '../src/app/core/models/domain.models';
import { hashPassword } from './auth';
import type { Db } from './db';

/**
 * Synthetic demo data for local runs and presentations. Every person, place and figure is invented.
 * Replaces all existing data, so it must never run against a production database.
 */
export async function seedDemo(db: Db): Promise<void> {
  const now = Date.now();
  const day = (offset: number): string => {
    const d = new Date(now + offset * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const today = day(0);
  const ago = (m: number): number => now - m * 60_000;

  const users: Array<[string, string, string, Role, string | null, string]> = [
    ['u-luka', 'delavec', 'Luka Kranjc', 'WORKER', 'Ekipa A', 'delavec-demo-2026'],
    ['u-admin', 'admin', 'Ana Zorko', 'ADMIN', null, 'admin-demo-2026'],
    ['u-maja', 'vodja', 'Maja Vidic', 'MANAGER', null, 'vodja-demo-2026'],
    ['u-sasa', 'delovodja', 'Saša Petek', 'FOREMAN', 'Ekipa A', 'delovodja-demo-2026'],
    ['u-matej', 'matej', 'Matej Zupan', 'WORKER', 'Ekipa B', 'demo-geslo-2026'],
    ['u-nejc', 'nejc', 'Nejc Horvat', 'WORKER', 'Ekipa B', 'demo-geslo-2026'],
    ['u-rok', 'rok', 'Rok Kralj', 'WORKER', 'Ekipa C', 'demo-geslo-2026'],
    ['u-jure', 'jure', 'Jure Potočnik', 'WORKER', 'Ekipa C', 'demo-geslo-2026'],
    ['u-tilen', 'tilen', 'Tilen Mlakar', 'WORKER', 'Ekipa A', 'demo-geslo-2026'],
    ['u-anze', 'anze', 'Anže Vidmar', 'WORKER', 'Ekipa B', 'demo-geslo-2026'],
    ['u-gasper', 'gasper', 'Gašper Kos', 'WORKER', 'Ekipa C', 'demo-geslo-2026'],
    ['u-blaz', 'blaz', 'Blaž Golob', 'WORKER', 'Ekipa A', 'demo-geslo-2026'],
  ];
  const hashes = new Map<string, string>();
  for (const pw of new Set(users.map((u) => u[5]))) hashes.set(pw, await hashPassword(pw));

  await db.tx(async (tx) => {
    for (const t of ['idempotency', 'consents', 'daily_summaries', 'photos', 'logs', 'time_entries', 'work_order_crew', 'work_orders', 'order_counters', 'site_foremen', 'project_managers', 'sites', 'projects', 'users']) {
      await tx.query(`delete from ${t}`);
    }
    for (const [id, username, name, role, crew, pw] of users) {
      await tx.query(`insert into users (id, username, display_name, role, crew, password_hash, active, created_at) values ($1,$2,$3,$4,$5,$6,true,$7)`, [
        id, username, name, role, crew, hashes.get(pw) ?? '', now,
      ]);
    }
    for (const [id, code, name] of [['p-hn', 'HN', 'Hiša Novak'], ['p-hm', 'HM', 'Hiša Müller'], ['p-hk', 'HK', 'Hiša Kovač']] as const) {
      await tx.query(`insert into projects (id, code, name, active, created_at) values ($1,$2,$3,true,$4)`, [id, code, name, now]);
    }
    for (const [id, project, code, name, city] of [
      ['s-hn', 'p-hn', 'HN-1', 'Maribor, Tezno', 'Maribor'],
      ['s-hn2', 'p-hn', 'HN-2', 'Maribor, garaža Pobrežje', 'Maribor'],
      ['s-hm', 'p-hm', 'HM-1', 'Celje, Lava', 'Celje'],
      ['s-hk', 'p-hk', 'HK-1', 'Ptuj, Rogoznica', 'Ptuj'],
    ] as const) {
      await tx.query(`insert into sites (id, project_id, code, name, city, active, created_at) values ($1,$2,$3,$4,$5,true,$6)`, [id, project, code, name, city, now]);
    }
    // Maja leads Hiša Novak and Hiša Müller; Hiša Kovač has no manager yet, so only the administrator sees it.
    // Saša is the foreman on the Tezno object of Hiša Novak.
    for (const project of ['p-hn', 'p-hm']) await tx.query(`insert into project_managers (project_id, user_id) values ($1, 'u-maja')`, [project]);
    await tx.query(`insert into site_foremen (site_id, user_id) values ('s-hn', 'u-sasa')`);

    type O = [id: string, code: string, site: string, project: string, title: string, desc: string, loc: string, crew: string[], status: string, published: boolean, unit: string, planned: number, done: number, est: number | null, materials: object[], date: string | null, due: string | null];
    const orders: O[] = [
      ['wo-125', '2026-125', 's-hn', 'p-hn', 'Montaža zunanjih stenskih elementov', 'Montaža zunanjih stenskih elementov na severni strani objekta.', 'Severna stran objekta', ['u-luka', 'u-blaz'], 'NEW', true, 'PCS', 8, 0, 480,
        [{ name: 'Stenski elementi', qty: 8, unit: 'kos' }, { name: 'Vijaki', qty: null, unit: null }, { name: 'Tesnilni material', qty: null, unit: null }], today, today],
      ['wo-126', '2026-126', 's-hn', 'p-hn', 'Sidranje jeklenih stebrov', 'Vgradnja sidrnih vijakov M12 v podložne plošče stebrov, os C. Navor 80 Nm.', 'Pritličje · os C / 1–3', ['u-luka'], 'NEW', true, 'PCS', 48, 0, 360,
        [{ name: 'Sidrni vijaki M12', qty: 48, unit: 'kos' }], day(1), day(3)],
      ['wo-127', '2026-127', 's-hn', 'p-hn', 'Fasadne letve, vzhod', 'Montaža podkonstrukcije za fasado, vzhodna stran, raster 600 mm.', 'Vzhodna fasada', ['u-luka', 'u-tilen'], 'NEW', true, 'M', 120, 0, 960,
        [{ name: 'Letve 40×60', qty: 130, unit: 'm' }], day(1), day(3)],
      ['wo-118', '2026-118', 's-hn', 'p-hn', 'Stenski paneli, nadstropje 1', 'Montaža izoliranih stenskih panelov, nadstropje 1.', 'Nadstropje 1 · osi A–D', ['u-luka'], 'COMPLETED', true, 'PCS', 32, 32, 900, [], day(-1), day(-1)],
      ['wo-121', '2026-121', 's-hn', 'p-hn', 'Podložne plošče stebrov', 'Poravnava in pritrditev podložnih plošč, os C.', 'Pritličje · os C / 2', ['u-tilen'], 'ISSUE', true, 'PCS', 12, 7, 300,
        [{ name: 'Sidrni vijaki M12', qty: 24, unit: 'kos' }], today, day(1)],
      ['wo-128', '2026-128', 's-hn2', 'p-hn', 'Garažna vrata, priprava odprtine', 'Priprava odprtine in nosilcev za sekcijska vrata.', 'Garaža', [], 'NEW', false, 'PCS', 1, 0, 240, [], null, day(3)],
      ['wo-122', '2026-122', 's-hm', 'p-hm', 'Strešna obroba', 'Montaža pločevinaste obrobe atike, severna in zahodna stran.', 'Streha · atika S/Z', ['u-matej'], 'IN_PROGRESS', true, 'M', 86, 41, 720,
        [{ name: 'Obroba Al 0,7 mm', qty: 90, unit: 'm' }], today, day(1)],
      ['wo-119', '2026-119', 's-hm', 'p-hm', 'Hidroizolacija kleti', 'Polaganje bitumenskih trakov, kletna stena vzhod.', 'Klet · vzhodna stena', ['u-nejc'], 'COMPLETED', true, 'M2', 64, 64, 360, [], today, today],
      ['wo-123', '2026-123', 's-hm', 'p-hm', 'Mavčne predelne stene', 'Podkonstrukcija in enostransko oblaganje, mansarda.', 'Mansarda · sobe 1–3', ['u-anze'], 'IN_PROGRESS', true, 'M2', 140, 52, 1440, [], today, day(3)],
      ['wo-120', '2026-120', 's-hk', 'p-hk', 'Strešni paneli', 'Montaža sendvič strešnih panelov nad garažo in bivalnim delom.', 'Streha · polja 1–3', ['u-rok'], 'COMPLETED', true, 'M2', 220, 220, 1200, [], today, today],
      ['wo-129', '2026-129', 's-hk', 'p-hk', 'Garažna sekcijska vrata', 'Montaža sekcijskih vrat 2,5×2,25 m.', 'Garaža', ['u-jure'], 'NEW', true, 'PCS', 2, 0, 300, [], day(1), day(1)],
      ['wo-124', '2026-124', 's-hk', 'p-hk', 'Žlebovi in odtoki', 'Montaža strešnih žlebov in vertikalnih odtokov, južna stran.', 'Južna stran', ['u-gasper', 'u-jure'], 'IN_PROGRESS', true, 'M', 96, 30, 600,
        [{ name: 'Žleb Ø 125', qty: 60, unit: 'm' }], today, day(3)],
    ];
    for (const o of orders) {
      await tx.query(
        `insert into work_orders (id, code, title, description, project_id, site_id, location, manager_id, status, published, unit, planned_qty, done_qty,
           estimated_minutes, materials, date, due_date, updated_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,'u-maja',$8,$9,$10,$11,$12,$13,$14::text::jsonb,$15,$16,$17,$17)`,
        [o[0], o[1], o[4], o[5], o[3], o[2], o[6], o[8], o[9], o[10], o[11], o[12], o[13], JSON.stringify(o[14]), o[15], o[16], now],
      );
      for (const uid of o[7]) await tx.query(`insert into work_order_crew (order_id, user_id) values ($1,$2)`, [o[0], uid]);
    }
    await tx.query(`insert into order_counters (year, last) values ($1, 129)`, [new Date().getFullYear()]);

    const entries: Array<[string, string, string, string | null, number, number | null]> = [
      ['t-matej', 'u-matej', 'SHIFT', null, 262, null], ['t-matej-1', 'u-matej', 'ORDER', 'wo-122', 250, null],
      ['t-nejc', 'u-nejc', 'SHIFT', null, 380, 25], ['t-nejc-1', 'u-nejc', 'ORDER', 'wo-119', 370, 30],
      ['t-rok', 'u-rok', 'SHIFT', null, 410, 40], ['t-rok-1', 'u-rok', 'ORDER', 'wo-120', 400, 45],
      ['t-tilen', 'u-tilen', 'SHIFT', null, 240, null], ['t-tilen-1', 'u-tilen', 'ORDER', 'wo-121', 230, 140],
      ['t-anze', 'u-anze', 'SHIFT', null, 205, null], ['t-anze-1', 'u-anze', 'ORDER', 'wo-123', 195, null],
      ['t-gasper', 'u-gasper', 'SHIFT', null, 300, null], ['t-gasper-1', 'u-gasper', 'ORDER', 'wo-124', 290, null],
      ['t-jure', 'u-jure', 'SHIFT', null, 280, null], ['t-jure-1', 'u-jure', 'ORDER', 'wo-124', 270, null],
    ];
    for (const [id, uid, kind, order, start, end] of entries) {
      await tx.query(
        `insert into time_entries (id, user_id, kind, work_order_id, date, started_at, ended_at, end_source, end_note, received_at) values ($1,$2,$3,$4,$5,$6,$7,$8,null,$9)`,
        [id, uid, kind, order, today, ago(start), end === null ? null : ago(end), end === null ? null : 'TAP', now],
      );
    }
    const logs: Array<[string, string, string, string, number | null, string | null, number]> = [
      ['l-121-1', 'u-tilen', 'wo-121', 'QUANTITY', 7, null, 150],
      ['l-121-2', 'u-tilen', 'wo-121', 'ISSUE', null, 'Manjkajo sidrni vijaki M12 za plošče 8–12 na osi C. Dobavnica jih navaja, na paleti jih ni.', 141],
      ['l-122-1', 'u-matej', 'wo-122', 'QUANTITY', 41, null, 60],
      ['l-122-2', 'u-matej', 'wo-122', 'NOTE', null, 'Severna stran končana, začenjam zahodno.', 58],
      ['l-119-1', 'u-nejc', 'wo-119', 'QUANTITY', 64, null, 35],
      ['l-120-1', 'u-rok', 'wo-120', 'QUANTITY', 220, null, 50],
      ['l-123-1', 'u-anze', 'wo-123', 'QUANTITY', 52, null, 20],
      ['l-124-1', 'u-gasper', 'wo-124', 'QUANTITY', 18, null, 90],
      ['l-124-2', 'u-jure', 'wo-124', 'QUANTITY', 12, null, 80],
    ];
    for (const [id, uid, order, kind, q, text, at] of logs) {
      await tx.query(`insert into logs (id, user_id, work_order_id, kind, quantity, text, created_at) values ($1,$2,$3,$4,$5,$6,$7)`, [id, uid, order, kind, q, text, ago(at)]);
    }
    const summaries: Array<[string, number, number, number, number, object[], string[], object[], string, number]> = [
      ['u-nejc', 380, 25, 355, 340,
        [{ workOrderId: 'wo-119', code: '2026-119', title: 'Hidroizolacija kleti', siteName: 'Hiša Müller · Celje, Lava', minutes: 340, quantity: 64, unit: 'M2',
          workDone: 'Položeni bitumenski trakovi na celotni vzhodni kletni steni, stiki zvarjeni in preverjeni.', materialsUsed: [{ name: 'Bitumenski trak', qty: 68, unit: 'm²' }], issues: [], photoCount: 0 }],
        ['2026-119'], [], 'Hidroizolacija kleti končana, pripravljeno za zasip.', 22],
      ['u-rok', 410, 40, 370, 355,
        [{ workOrderId: 'wo-120', code: '2026-120', title: 'Strešni paneli', siteName: 'Hiša Kovač · Ptuj, Rogoznica', minutes: 355, quantity: 220, unit: 'M2',
          workDone: 'Montirana zadnja polja strešnih panelov nad bivalnim delom. Streha je zaprta.', materialsUsed: [{ name: 'Sendvič paneli', qty: 220, unit: 'm²' }, { name: 'Samorezni vijaki', qty: 900, unit: 'kos' }], issues: [], photoCount: 0 }],
        ['2026-120'], [{ field: 'ARRIVAL', recordedAt: ago(410), proposedAt: ago(425), reason: 'Na objektu sem bil 15 minut prej, telefon je imel prazno baterijo.' }],
        'Streha zaprta. Jutri potrebujemo avtodvigalo ob 7:00.', 38],
    ];
    for (const [uid, arr, dep, shiftMin, orderMin, lines, worked, corrections, comment, sub] of summaries) {
      await tx.query(
        `insert into daily_summaries (id, user_id, date, arrival_at, departure_at, shift_minutes, order_minutes, lines, orders_worked, issues_reported, photos_taken,
           declared_end, corrections, comment, status, submitted_at) values ($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb,$9::text::jsonb,0,0,false,$10::text::jsonb,$11,'SUBMITTED',$12)`,
        [`sum-${uid}-${today}`, uid, today, ago(arr), ago(dep), shiftMin, orderMin, JSON.stringify(lines), JSON.stringify(worked), JSON.stringify(corrections), comment, ago(sub)],
      );
    }
  });
}
