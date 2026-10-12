import type { DailySummary, IsoDate, LogEntry, Material, Project, Site, TimeEntry } from '../core/models/domain.models';
import { toIsoDate } from '../core/util/util';
import type { MockOrder, MockServerDb, MockUser } from './mock-db';

/**
 * Synthetic demo data. Every person, site detail and figure here is invented and labelled
 * "demo data" in the UI. No real personal data and no photos: photos come only from a device camera.
 */

const SEED_VERSION = '7';

export const DEMO_WORKER_ID = 'u-luka';
export const DEMO_MANAGER_ID = 'u-maja';

const PROJECTS: Project[] = [
  { id: 'p-hn', code: 'HN', name: 'Hiša Novak' },
  { id: 'p-hm', code: 'HM', name: 'Hiša Müller' },
  { id: 'p-hk', code: 'HK', name: 'Hiša Kovač' },
];

const SITES: Site[] = [
  { id: 's-hn', code: 'HN', projectId: 'p-hn', projectName: 'Hiša Novak', name: 'Maribor, Tezno', city: 'Maribor' },
  { id: 's-hm', code: 'HM', projectId: 'p-hm', projectName: 'Hiša Müller', name: 'Celje, Lava', city: 'Celje' },
  { id: 's-hk', code: 'HK', projectId: 'p-hk', projectName: 'Hiša Kovač', name: 'Ptuj, Rogoznica', city: 'Ptuj' },
];

const USERS: MockUser[] = [
  { id: DEMO_WORKER_ID, username: 'delavec', password: 'delavec', displayName: 'Luka Kranjc', role: 'WORKER', crew: 'Ekipa A' },
  { id: DEMO_MANAGER_ID, username: 'vodja', password: 'vodja', displayName: 'Maja Vidic', role: 'MANAGER', canManageProjects: true },
  { id: 'u-matej', username: 'matej', password: 'demo', displayName: 'Matej Zupan', role: 'WORKER', crew: 'Ekipa B' },
  { id: 'u-nejc', username: 'nejc', password: 'demo', displayName: 'Nejc Horvat', role: 'WORKER', crew: 'Ekipa B' },
  { id: 'u-rok', username: 'rok', password: 'demo', displayName: 'Rok Kralj', role: 'WORKER', crew: 'Ekipa C' },
  { id: 'u-jure', username: 'jure', password: 'demo', displayName: 'Jure Potočnik', role: 'WORKER', crew: 'Ekipa C' },
  { id: 'u-tilen', username: 'tilen', password: 'demo', displayName: 'Tilen Mlakar', role: 'WORKER', crew: 'Ekipa A' },
  { id: 'u-anze', username: 'anze', password: 'demo', displayName: 'Anže Vidmar', role: 'WORKER', crew: 'Ekipa B' },
  { id: 'u-gasper', username: 'gasper', password: 'demo', displayName: 'Gašper Kos', role: 'WORKER', crew: 'Ekipa C' },
  { id: 'u-blaz', username: 'blaz', password: 'demo', displayName: 'Blaž Golob', role: 'WORKER', crew: 'Ekipa A' },
];

export function siteLabel(site: Site): string {
  return `${site.projectName} · ${site.name}`;
}

export function crewOf(ids: readonly string[], users: readonly MockUser[]): MockOrder['crew'] {
  return ids.flatMap((id) => {
    const u = users.find((x) => x.id === id);
    return u ? [{ id: u.id, displayName: u.displayName }] : [];
  });
}

interface OrderSeed {
  readonly id: string;
  readonly code: string;
  readonly siteId: string;
  readonly title: string;
  readonly description: string;
  readonly location: string;
  readonly crewIds: readonly string[];
  readonly status: MockOrder['status'];
  readonly published?: boolean;
  readonly unit: MockOrder['unit'];
  readonly plannedQty: number;
  readonly doneQty: number;
  readonly estimatedMinutes: number | null;
  readonly materials?: readonly Material[];
  readonly date: IsoDate | null;
  readonly dueDate: IsoDate | null;
}

function order(s: OrderSeed): MockOrder {
  const site = SITES.find((x) => x.id === s.siteId);
  const manager = USERS.find((u) => u.id === DEMO_MANAGER_ID);
  return {
    id: s.id,
    code: s.code,
    title: s.title,
    description: s.description,
    projectId: site?.projectId ?? '',
    siteId: s.siteId,
    siteName: site ? siteLabel(site) : s.siteId,
    location: s.location,
    crewIds: s.crewIds,
    crew: crewOf(s.crewIds, USERS),
    managerId: DEMO_MANAGER_ID,
    managerName: manager?.displayName ?? '',
    status: s.status,
    published: s.published ?? true,
    unit: s.unit,
    plannedQty: s.plannedQty,
    doneQty: s.doneQty,
    estimatedMinutes: s.estimatedMinutes,
    materials: s.materials ?? [],
    date: s.date,
    dueDate: s.dueDate,
    updatedAt: Date.now(),
  };
}

export async function ensureSeeded(db: MockServerDb): Promise<void> {
  const today = toIsoDate();
  const seededFor = await db.meta.get('seededFor');
  if (seededFor?.value === `${SEED_VERSION}:${today}`) return;

  const now = Date.now();
  const tomorrow = toIsoDate(now + 86_400_000);
  const inThreeDays = toIsoDate(now + 3 * 86_400_000);
  const yesterday = toIsoDate(now - 86_400_000);
  const minutesAgo = (m: number): number => now - m * 60_000;

  const orders: MockOrder[] = [
    order({
      id: 'wo-125', code: '2026-00125', siteId: 's-hn',
      title: 'Montaža zunanjih stenskih elementov',
      description: 'Montaža zunanjih stenskih elementov na severni strani objekta.',
      location: 'Severna stran objekta', crewIds: [DEMO_WORKER_ID, 'u-blaz'], status: 'NEW',
      unit: 'PCS', plannedQty: 8, doneQty: 0, estimatedMinutes: 480,
      materials: [
        { name: 'Stenski elementi', qty: 8, unit: 'kos' },
        { name: 'Vijaki', qty: null, unit: null },
        { name: 'Tesnilni material', qty: null, unit: null },
      ],
      date: today, dueDate: today,
    }),
    order({
      id: 'wo-126', code: '2026-00126', siteId: 's-hn', title: 'Sidranje jeklenih stebrov',
      description: 'Vgradnja sidrnih vijakov M12 v podložne plošče stebrov, os C. Navor 80 Nm.',
      location: 'Pritličje · os C / 1–3', crewIds: [DEMO_WORKER_ID], status: 'NEW',
      unit: 'PCS', plannedQty: 48, doneQty: 0, estimatedMinutes: 360,
      materials: [{ name: 'Sidrni vijaki M12', qty: 48, unit: 'kos' }],
      date: tomorrow, dueDate: inThreeDays,
    }),
    order({
      id: 'wo-127', code: '2026-00127', siteId: 's-hn', title: 'Fasadne letve, vzhod',
      description: 'Montaža podkonstrukcije za fasado, vzhodna stran, raster 600 mm.',
      location: 'Vzhodna fasada', crewIds: [DEMO_WORKER_ID, 'u-tilen'], status: 'NEW',
      unit: 'M', plannedQty: 120, doneQty: 0, estimatedMinutes: 960,
      materials: [{ name: 'Letve 40×60', qty: 130, unit: 'm' }, { name: 'Vijaki za les', qty: null, unit: null }],
      date: tomorrow, dueDate: inThreeDays,
    }),
    order({
      id: 'wo-118', code: '2026-00118', siteId: 's-hn', title: 'Stenski paneli, nadstropje 1',
      description: 'Montaža izoliranih stenskih panelov, nadstropje 1.', location: 'Nadstropje 1 · osi A–D',
      crewIds: [DEMO_WORKER_ID], status: 'COMPLETED', unit: 'PCS', plannedQty: 32, doneQty: 32, estimatedMinutes: 900,
      date: yesterday, dueDate: yesterday,
    }),
    order({
      id: 'wo-121', code: '2026-00121', siteId: 's-hn', title: 'Podložne plošče stebrov',
      description: 'Poravnava in pritrditev podložnih plošč, os C.', location: 'Pritličje · os C / 2',
      crewIds: ['u-tilen'], status: 'ISSUE', unit: 'PCS', plannedQty: 12, doneQty: 7, estimatedMinutes: 300,
      materials: [{ name: 'Sidrni vijaki M12', qty: 24, unit: 'kos' }],
      date: today, dueDate: tomorrow,
    }),
    order({
      id: 'wo-128', code: '2026-00128', siteId: 's-hn', title: 'Okenske police, nadstropje 2',
      description: 'Montaža notranjih okenskih polic.', location: 'Nadstropje 2', crewIds: [], status: 'NEW', published: false,
      unit: 'PCS', plannedQty: 18, doneQty: 0, estimatedMinutes: 240, date: null, dueDate: inThreeDays,
    }),
    order({
      id: 'wo-122', code: '2026-00122', siteId: 's-hm', title: 'Strešna obroba',
      description: 'Montaža pločevinaste obrobe atike, severna in zahodna stran.', location: 'Streha · atika S/Z',
      crewIds: ['u-matej'], status: 'IN_PROGRESS', unit: 'M', plannedQty: 86, doneQty: 41, estimatedMinutes: 720,
      materials: [{ name: 'Obroba Al 0,7 mm', qty: 90, unit: 'm' }],
      date: today, dueDate: tomorrow,
    }),
    order({
      id: 'wo-119', code: '2026-00119', siteId: 's-hm', title: 'Hidroizolacija kleti',
      description: 'Polaganje bitumenskih trakov, kletna stena vzhod.', location: 'Klet · vzhodna stena',
      crewIds: ['u-nejc'], status: 'COMPLETED', unit: 'M2', plannedQty: 64, doneQty: 64, estimatedMinutes: 360,
      materials: [{ name: 'Bitumenski trak', qty: 70, unit: 'm²' }],
      date: today, dueDate: today,
    }),
    order({
      id: 'wo-123', code: '2026-00123', siteId: 's-hm', title: 'Mavčne predelne stene',
      description: 'Podkonstrukcija in enostransko oblaganje, mansarda.', location: 'Mansarda · sobe 1–3',
      crewIds: ['u-anze'], status: 'IN_PROGRESS', unit: 'M2', plannedQty: 140, doneQty: 52, estimatedMinutes: 1440,
      date: today, dueDate: inThreeDays,
    }),
    order({
      id: 'wo-120', code: '2026-00120', siteId: 's-hk', title: 'Strešni paneli',
      description: 'Montaža sendvič strešnih panelov nad garažo in bivalnim delom.', location: 'Streha · polja 1–3',
      crewIds: ['u-rok'], status: 'COMPLETED', unit: 'M2', plannedQty: 220, doneQty: 220, estimatedMinutes: 1200,
      date: today, dueDate: today,
    }),
    order({
      id: 'wo-129', code: '2026-00129', siteId: 's-hk', title: 'Garažna sekcijska vrata',
      description: 'Montaža sekcijskih vrat 2,5×2,25 m.', location: 'Garaža', crewIds: ['u-jure'], status: 'NEW',
      unit: 'PCS', plannedQty: 2, doneQty: 0, estimatedMinutes: 300, date: tomorrow, dueDate: tomorrow,
    }),
    order({
      id: 'wo-124', code: '2026-00124', siteId: 's-hk', title: 'Žlebovi in odtoki',
      description: 'Montaža strešnih žlebov in vertikalnih odtokov, južna stran.', location: 'Južna stran',
      crewIds: ['u-gasper', 'u-jure'], status: 'IN_PROGRESS', unit: 'M', plannedQty: 96, doneQty: 30, estimatedMinutes: 600,
      materials: [{ name: 'Žleb Ø 125', qty: 60, unit: 'm' }, { name: 'Odtočna cev Ø 100', qty: 36, unit: 'm' }],
      date: today, dueDate: inThreeDays,
    }),
  ];

  const shift = (id: string, userId: string, startMinAgo: number, endMinAgo: number | null): TimeEntry => ({
    id,
    userId,
    kind: 'SHIFT',
    workOrderId: null,
    date: today,
    startedAt: minutesAgo(startMinAgo),
    endedAt: endMinAgo === null ? null : minutesAgo(endMinAgo),
    endSource: 'TAP',
  });
  const seg = (id: string, userId: string, workOrderId: string, startMinAgo: number, endMinAgo: number | null): TimeEntry => ({
    ...shift(id, userId, startMinAgo, endMinAgo),
    kind: 'ORDER',
    workOrderId,
  });

  const timeEntries: TimeEntry[] = [
    shift('t-matej', 'u-matej', 262, null),
    seg('t-matej-1', 'u-matej', 'wo-122', 250, null),
    shift('t-nejc', 'u-nejc', 380, 25),
    seg('t-nejc-1', 'u-nejc', 'wo-119', 370, 30),
    shift('t-rok', 'u-rok', 410, 40),
    seg('t-rok-1', 'u-rok', 'wo-120', 400, 45),
    shift('t-tilen', 'u-tilen', 240, null),
    seg('t-tilen-1', 'u-tilen', 'wo-121', 230, 140),
    shift('t-anze', 'u-anze', 205, null),
    seg('t-anze-1', 'u-anze', 'wo-123', 195, null),
    shift('t-gasper', 'u-gasper', 300, null),
    seg('t-gasper-1', 'u-gasper', 'wo-124', 290, null),
    shift('t-jure', 'u-jure', 280, null),
    seg('t-jure-1', 'u-jure', 'wo-124', 270, null),
    {
      id: 't-luka-y',
      userId: DEMO_WORKER_ID,
      kind: 'SHIFT',
      workOrderId: null,
      date: yesterday,
      startedAt: now - 86_400_000 - 8 * 3_600_000,
      endedAt: now - 86_400_000 - 30 * 60_000,
      endSource: 'TAP',
    },
  ];

  const logs: LogEntry[] = [
    { id: 'l-121-1', userId: 'u-tilen', workOrderId: 'wo-121', kind: 'QUANTITY', quantity: 7, text: null, createdAt: minutesAgo(150) },
    { id: 'l-121-2', userId: 'u-tilen', workOrderId: 'wo-121', kind: 'ISSUE', quantity: null, text: 'Manjkajo sidrni vijaki M12 za plošče 8–12 na osi C. Dobavnica jih navaja, na paleti jih ni.', createdAt: minutesAgo(141) },
    { id: 'l-122-1', userId: 'u-matej', workOrderId: 'wo-122', kind: 'QUANTITY', quantity: 41, text: null, createdAt: minutesAgo(60) },
    { id: 'l-122-2', userId: 'u-matej', workOrderId: 'wo-122', kind: 'NOTE', quantity: null, text: 'Severna stran končana, začenjam zahodno.', createdAt: minutesAgo(58) },
    { id: 'l-119-1', userId: 'u-nejc', workOrderId: 'wo-119', kind: 'QUANTITY', quantity: 64, text: null, createdAt: minutesAgo(35) },
    { id: 'l-120-1', userId: 'u-rok', workOrderId: 'wo-120', kind: 'QUANTITY', quantity: 220, text: null, createdAt: minutesAgo(50) },
    { id: 'l-123-1', userId: 'u-anze', workOrderId: 'wo-123', kind: 'QUANTITY', quantity: 52, text: null, createdAt: minutesAgo(20) },
    { id: 'l-124-1', userId: 'u-gasper', workOrderId: 'wo-124', kind: 'QUANTITY', quantity: 18, text: null, createdAt: minutesAgo(90) },
    { id: 'l-124-2', userId: 'u-jure', workOrderId: 'wo-124', kind: 'QUANTITY', quantity: 12, text: null, createdAt: minutesAgo(80) },
    { id: 'l-118-1', userId: DEMO_WORKER_ID, workOrderId: 'wo-118', kind: 'QUANTITY', quantity: 32, text: null, createdAt: now - 86_400_000 - 60 * 60_000 },
  ];

  const summaries: DailySummary[] = [
    {
      id: `sum-u-nejc-${today}`,
      userId: 'u-nejc',
      date: today,
      arrivalAt: minutesAgo(380),
      departureAt: minutesAgo(25),
      shiftMinutes: 355,
      orderMinutes: 340,
      lines: [
        {
          workOrderId: 'wo-119', code: '2026-00119', title: 'Hidroizolacija kleti', siteName: 'Hiša Müller · Celje, Lava',
          minutes: 340, quantity: 64, unit: 'M2',
          workDone: 'Položeni bitumenski trakovi na celotni vzhodni kletni steni, stiki zvarjeni in preverjeni.',
          materialsUsed: [{ name: 'Bitumenski trak', qty: 68, unit: 'm²' }],
          issues: [], photoCount: 0,
        },
      ],
      ordersWorked: ['2026-00119'],
      issuesReported: 0,
      photosTaken: 0,
      declaredEnd: false,
      corrections: [],
      comment: 'Hidroizolacija kleti končana, pripravljeno za zasip.',
      status: 'SUBMITTED',
      submittedAt: minutesAgo(22),
      reviewedAt: null,
      reviewerName: null,
      reviewerNote: null,
    },
    {
      id: `sum-u-rok-${today}`,
      userId: 'u-rok',
      date: today,
      arrivalAt: minutesAgo(410),
      departureAt: minutesAgo(40),
      shiftMinutes: 370,
      orderMinutes: 355,
      lines: [
        {
          workOrderId: 'wo-120', code: '2026-00120', title: 'Strešni paneli', siteName: 'Hiša Kovač · Ptuj, Rogoznica',
          minutes: 355, quantity: 220, unit: 'M2',
          workDone: 'Montirana zadnja polja strešnih panelov nad bivalnim delom. Streha je zaprta.',
          materialsUsed: [{ name: 'Sendvič paneli', qty: 220, unit: 'm²' }, { name: 'Samorezni vijaki', qty: 900, unit: 'kos' }],
          issues: [], photoCount: 0,
        },
      ],
      ordersWorked: ['2026-00120'],
      issuesReported: 0,
      photosTaken: 0,
      declaredEnd: false,
      corrections: [
        { field: 'ARRIVAL', recordedAt: minutesAgo(410), proposedAt: minutesAgo(425), reason: 'Na objektu sem bil 15 minut prej, telefon je imel prazno baterijo.' },
      ],
      comment: 'Streha zaprta. Jutri potrebujemo avtodvigalo ob 7:00.',
      status: 'SUBMITTED',
      submittedAt: minutesAgo(38),
      reviewedAt: null,
      reviewerName: null,
      reviewerNote: null,
    },
  ];

  await db.transaction(
    'rw',
    [db.users, db.projects, db.sites, db.orders, db.timeEntries, db.logs, db.photos, db.summaries, db.idempotency, db.meta],
    async () => {
      await Promise.all([
        db.users.clear(),
        db.projects.clear(),
        db.sites.clear(),
        db.orders.clear(),
        db.timeEntries.clear(),
        db.logs.clear(),
        db.photos.clear(),
        db.summaries.clear(),
        db.idempotency.clear(),
      ]);
      await db.users.bulkPut(USERS);
      await db.projects.bulkPut(PROJECTS);
      await db.sites.bulkPut(SITES);
      await db.orders.bulkPut(orders);
      await db.timeEntries.bulkPut(timeEntries);
      await db.logs.bulkPut(logs);
      await db.summaries.bulkPut(summaries);
      await db.meta.put({ key: 'seededFor', value: `${SEED_VERSION}:${today}` });
    },
  );
}
