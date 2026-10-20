import type { DailySummary, IsoDate, LogEntry, Material, Project, Site, TimeEntry } from '../core/models/domain.models';
import { toIsoDate } from '../core/util/util';
import type { MockOrder, MockServerDb, MockUser } from './mock-db';

/**
 * Synthetic demo data. Every person, site detail and figure here is invented and labelled
 * "demo data" in the UI. No real personal data and no photos: photos come only from a device camera.
 */

const SEED_VERSION = '13';

export const DEMO_WORKER_ID = 'u-luka';
export const DEMO_MANAGER_ID = 'u-maja';

const PROJECTS: Project[] = [
  { id: 'p-hn', code: 'HN', name: 'Hiša Novak' },
  { id: 'p-pl', code: 'PL', name: 'Poslovni objekt Lent' },
];

const SITES: Site[] = [
  { id: 's-hn', code: 'HN-1', projectId: 'p-hn', projectName: 'Hiša Novak', name: 'Maribor', city: 'Maribor' },
  { id: 's-hn2', code: 'HN-2', projectId: 'p-hn', projectName: 'Hiša Novak', name: 'Ptuj', city: 'Ptuj' },
  { id: 's-pl', code: 'PL-1', projectId: 'p-pl', projectName: 'Poslovni objekt Lent', name: 'Maribor', city: 'Maribor' },
];

const USERS: MockUser[] = [
  { id: DEMO_WORKER_ID, username: 'delavec', password: 'delavec', displayName: 'Janez Kos', role: 'WORKER', crew: 'Ekipa A' },
  // The demo desk account is the administrator, so a presentation can show every screen.
  { id: DEMO_MANAGER_ID, username: 'vodja', password: 'vodja', displayName: 'Marko Vidmar', role: 'ADMIN' },
  { id: 'u-sasa', username: 'delovodja', password: 'delovodja', displayName: 'Saša Petek', role: 'FOREMAN', crew: 'Ekipa A', siteIds: ['s-hn'] },
  { id: 'u-irena', username: 'irena', password: 'demo', displayName: 'Irena Golob', role: 'MANAGER', projectIds: ['p-pl'] },
  { id: 'u-matej', username: 'peter', password: 'demo', displayName: 'Peter Novak', role: 'WORKER', crew: 'Ekipa B' },
  { id: 'u-nejc', username: 'ana', password: 'demo', displayName: 'Ana Zupan', role: 'WORKER', crew: 'Ekipa B' },
  { id: 'u-rok', username: 'tomaz', password: 'demo', displayName: 'Tomaž Kralj', role: 'WORKER', crew: 'Ekipa C' },
  { id: 'u-jure', username: 'jure', password: 'demo', displayName: 'Jure Potočnik', role: 'WORKER', crew: 'Ekipa C' },
  { id: 'u-tilen', username: 'tilen', password: 'demo', displayName: 'Tilen Mlakar', role: 'WORKER', crew: 'Ekipa A' },
  { id: 'u-anze', username: 'anze', password: 'demo', displayName: 'Anže Breznik', role: 'WORKER', crew: 'Ekipa B' },
  { id: 'u-gasper', username: 'gasper', password: 'demo', displayName: 'Gašper Rozman', role: 'WORKER', crew: 'Ekipa C' },
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
  const DAY = 86_400_000;
  const day = (offset: number): IsoDate => toIsoDate(now + offset * DAY);
  const minutesAgo = (m: number): number => now - m * 60_000;
  /** A fixed clock time on another day, e.g. at(-1, 7, 2) is yesterday 07:02. */
  const at = (offset: number, h: number, m: number): number => {
    const d = new Date(now + offset * DAY);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };

  const orders: MockOrder[] = [
    // Hiša Novak · Maribor
    order({
      id: 'wo-124', code: '2026-00124', siteId: 's-hn', title: 'Priprava terena',
      description: 'Izravnava in utrjevanje platoja za montažo, odvoz viška zemljine.',
      location: 'Plato ob severni strani', crewIds: [DEMO_WORKER_ID], status: 'IN_PROGRESS',
      unit: 'M2', plannedQty: 120, doneQty: 90, estimatedMinutes: 360,
      date: day(-2), dueDate: day(-1),
    }),
    order({
      id: 'wo-125', code: '2026-00125', siteId: 's-hn', title: 'Montaža stenskih elementov',
      description: 'Montaža zunanjih stenskih elementov na severni strani objekta.',
      location: 'Severna stran objekta', crewIds: [DEMO_WORKER_ID], status: 'IN_PROGRESS',
      unit: 'PCS', plannedQty: 8, doneQty: 5, estimatedMinutes: 480,
      materials: [
        { name: 'Stenski element tip A', qty: 10, unit: 'kos' },
        { name: 'Vijaki M8x120', qty: 200, unit: 'kos' },
      ],
      date: day(-2), dueDate: day(2),
    }),
    order({
      id: 'wo-126', code: '2026-00126', siteId: 's-hn', title: 'Elektroinštalacije grobe',
      description: 'Polaganje cevi in doz za elektroinštalacije, pritličje.',
      location: 'Pritličje', crewIds: ['u-matej'], status: 'NEW',
      unit: 'M', plannedQty: 140, doneQty: 0, estimatedMinutes: 600,
      date: day(1), dueDate: day(5),
    }),
    order({
      id: 'wo-127', code: '2026-00127', siteId: 's-hn', title: 'Vodovod in kanalizacija',
      description: 'Razvod vodovoda in kanalizacije v kletni etaži.',
      location: 'Klet', crewIds: ['u-nejc'], status: 'NEW',
      unit: 'M', plannedQty: 60, doneQty: 0, estimatedMinutes: 720,
      date: day(2), dueDate: day(7),
    }),
    order({
      id: 'wo-128', code: '2026-00128', siteId: 's-hn', title: 'Betoniranje plošče',
      description: 'Betoniranje medetažne plošče nad pritličjem, C25/30.',
      location: 'Plošča nad pritličjem', crewIds: ['u-rok'], status: 'ISSUE',
      unit: 'M3', plannedQty: 24, doneQty: 18, estimatedMinutes: 480,
      materials: [{ name: 'Beton C25/30', qty: 24, unit: 'm³' }],
      date: day(-1), dueDate: day(-2),
    }),
    order({
      id: 'wo-129', code: '2026-00129', siteId: 's-hn', title: 'Opaževanje',
      description: 'Opaž medetažne plošče in robnih nosilcev.',
      location: 'Plošča nad pritličjem', crewIds: [DEMO_WORKER_ID], status: 'COMPLETED',
      unit: 'M2', plannedQty: 96, doneQty: 96, estimatedMinutes: 480,
      date: day(-3), dueDate: day(-3),
    }),
    // Hiša Novak · Ptuj
    order({
      id: 'wo-130', code: '2026-00130', siteId: 's-hn2', title: 'Hidroizolacija kleti',
      description: 'Polaganje bitumenskih trakov, kletna stena vzhod.', location: 'Klet · vzhodna stena',
      crewIds: ['u-nejc'], status: 'COMPLETED', unit: 'M2', plannedQty: 64, doneQty: 64, estimatedMinutes: 360,
      materials: [{ name: 'Bitumenski trak', qty: 70, unit: 'm²' }],
      date: today, dueDate: today,
    }),
    order({
      id: 'wo-131', code: '2026-00131', siteId: 's-hn2', title: 'Strešni paneli',
      description: 'Montaža sendvič strešnih panelov nad garažo in bivalnim delom.', location: 'Streha · polja 1–3',
      crewIds: ['u-tilen', 'u-matej'], status: 'IN_PROGRESS', unit: 'M2', plannedQty: 220, doneQty: 140, estimatedMinutes: 1200,
      date: day(-1), dueDate: day(1),
    }),
    order({
      id: 'wo-132', code: '2026-00132', siteId: 's-hn2', title: 'Garažna sekcijska vrata',
      description: 'Montaža sekcijskih vrat 2,5×2,25 m.', location: 'Garaža', crewIds: ['u-jure'], status: 'NEW',
      unit: 'PCS', plannedQty: 2, doneQty: 0, estimatedMinutes: 300, date: day(1), dueDate: day(1),
    }),
    // Poslovni objekt Lent · Maribor
    order({
      id: 'wo-133', code: '2026-00133', siteId: 's-pl', title: 'Strešna obroba',
      description: 'Montaža pločevinaste obrobe atike, severna in zahodna stran.', location: 'Streha · atika S/Z',
      crewIds: ['u-anze'], status: 'IN_PROGRESS', unit: 'M', plannedQty: 86, doneQty: 41, estimatedMinutes: 720,
      materials: [{ name: 'Obroba Al 0,7 mm', qty: 90, unit: 'm' }],
      date: today, dueDate: day(1),
    }),
    order({
      id: 'wo-134', code: '2026-00134', siteId: 's-pl', title: 'Mavčne stene',
      description: 'Podkonstrukcija in enostransko oblaganje, 2. nadstropje.', location: '2. nadstropje · pisarne 1–3',
      crewIds: ['u-gasper'], status: 'IN_PROGRESS', unit: 'M2', plannedQty: 140, doneQty: 52, estimatedMinutes: 360,
      materials: [
        { name: 'Mavčne plošče 12,5 mm', qty: 60, unit: 'kos' },
        { name: 'CW profili', qty: 120, unit: 'm' },
      ],
      date: today, dueDate: day(3),
    }),
    order({
      id: 'wo-135', code: '2026-00135', siteId: 's-pl', title: 'Okenske police, nadstropje 2',
      description: 'Montaža notranjih okenskih polic.', location: '2. nadstropje', crewIds: ['u-blaz'], status: 'ISSUE',
      unit: 'PCS', plannedQty: 18, doneQty: 0, estimatedMinutes: 240, date: today, dueDate: day(3),
    }),
  ];

  const entry = (id: string, userId: string, kind: TimeEntry['kind'], workOrderId: string | null, startedAt: number, endedAt: number | null): TimeEntry => ({
    id,
    userId,
    kind,
    workOrderId,
    date: toIsoDate(startedAt),
    startedAt,
    endedAt,
    endSource: 'TAP',
  });

  const timeEntries: TimeEntry[] = [
    // Janez Kos: past days only, so the worker demo starts today clean.
    entry('t-janez-3', DEMO_WORKER_ID, 'SHIFT', null, at(-3, 6, 55), at(-3, 15, 5)),
    entry('t-janez-3a', DEMO_WORKER_ID, 'ORDER', 'wo-129', at(-3, 7, 0), at(-3, 15, 0)),
    entry('t-janez-2', DEMO_WORKER_ID, 'SHIFT', null, at(-2, 6, 45), at(-2, 15, 0)),
    entry('t-janez-2a', DEMO_WORKER_ID, 'ORDER', 'wo-124', at(-2, 6, 50), at(-2, 11, 20)),
    entry('t-janez-2b', DEMO_WORKER_ID, 'ORDER', 'wo-125', at(-2, 12, 0), at(-2, 14, 0)),
    entry('t-janez-1', DEMO_WORKER_ID, 'SHIFT', null, at(-1, 6, 58), at(-1, 15, 31)),
    entry('t-janez-1a', DEMO_WORKER_ID, 'ORDER', 'wo-125', at(-1, 6, 58), at(-1, 11, 28)),
    // Tomaž Kralj: the concrete pour, held today.
    entry('t-tomaz-1', 'u-rok', 'SHIFT', null, at(-1, 7, 0), at(-1, 10, 0)),
    entry('t-tomaz-1a', 'u-rok', 'ORDER', 'wo-128', at(-1, 7, 30), at(-1, 10, 0)),
    entry('t-tomaz', 'u-rok', 'SHIFT', null, minutesAgo(310), null),
    entry('t-tomaz-a', 'u-rok', 'ORDER', 'wo-128', minutesAgo(300), null),
    // Ana Zupan: finished today, report submitted.
    entry('t-ana', 'u-nejc', 'SHIFT', null, minutesAgo(380), minutesAgo(25)),
    entry('t-ana-a', 'u-nejc', 'ORDER', 'wo-130', minutesAgo(370), minutesAgo(30)),
    // Roof crew in Ptuj.
    entry('t-tilen', 'u-tilen', 'SHIFT', null, minutesAgo(240), null),
    entry('t-tilen-a', 'u-tilen', 'ORDER', 'wo-131', minutesAgo(230), null),
    entry('t-peter', 'u-matej', 'SHIFT', null, minutesAgo(262), null),
    entry('t-peter-a', 'u-matej', 'ORDER', 'wo-131', minutesAgo(250), null),
    // Lent.
    entry('t-anze', 'u-anze', 'SHIFT', null, minutesAgo(205), null),
    entry('t-anze-a', 'u-anze', 'ORDER', 'wo-133', minutesAgo(195), null),
    entry('t-gasper', 'u-gasper', 'SHIFT', null, minutesAgo(300), null),
    entry('t-gasper-a', 'u-gasper', 'ORDER', 'wo-134', minutesAgo(290), null),
    entry('t-blaz', 'u-blaz', 'SHIFT', null, minutesAgo(180), null),
    entry('t-blaz-a', 'u-blaz', 'ORDER', 'wo-135', minutesAgo(170), minutesAgo(80)),
  ];

  const logs: LogEntry[] = [
    { id: 'l-125-1', userId: DEMO_WORKER_ID, workOrderId: 'wo-125', kind: 'QUANTITY', quantity: 2, text: null, createdAt: at(-2, 13, 55) },
    { id: 'l-125-2', userId: DEMO_WORKER_ID, workOrderId: 'wo-125', kind: 'QUANTITY', quantity: 3, text: null, createdAt: at(-1, 11, 20) },
    { id: 'l-125-3', userId: DEMO_WORKER_ID, workOrderId: 'wo-125', kind: 'ISSUE', quantity: null, text: 'Manjka material: 2 kosa OSB plošče', createdAt: at(-1, 11, 25) },
    { id: 'l-124-1', userId: DEMO_WORKER_ID, workOrderId: 'wo-124', kind: 'QUANTITY', quantity: 90, text: null, createdAt: at(-2, 11, 15) },
    { id: 'l-129-1', userId: DEMO_WORKER_ID, workOrderId: 'wo-129', kind: 'QUANTITY', quantity: 96, text: null, createdAt: at(-3, 14, 50) },
    { id: 'l-128-1', userId: 'u-rok', workOrderId: 'wo-128', kind: 'QUANTITY', quantity: 18, text: null, createdAt: minutesAgo(150) },
    { id: 'l-128-2', userId: 'u-rok', workOrderId: 'wo-128', kind: 'ISSUE', quantity: null, text: 'Betonarna zamuja z zadnjo mešalko, manjka 6 m³ betona. Delovni stik je zaščiten.', createdAt: minutesAgo(141) },
    { id: 'l-130-1', userId: 'u-nejc', workOrderId: 'wo-130', kind: 'QUANTITY', quantity: 64, text: null, createdAt: minutesAgo(35) },
    { id: 'l-131-1', userId: 'u-tilen', workOrderId: 'wo-131', kind: 'QUANTITY', quantity: 140, text: null, createdAt: minutesAgo(60) },
    { id: 'l-131-2', userId: 'u-matej', workOrderId: 'wo-131', kind: 'NOTE', quantity: null, text: 'Polji 1 in 2 sta zaprti, začenjamo polje 3.', createdAt: minutesAgo(58) },
    { id: 'l-133-1', userId: 'u-anze', workOrderId: 'wo-133', kind: 'QUANTITY', quantity: 41, text: null, createdAt: minutesAgo(90) },
    { id: 'l-134-1', userId: 'u-gasper', workOrderId: 'wo-134', kind: 'QUANTITY', quantity: 52, text: null, createdAt: minutesAgo(20) },
    { id: 'l-134-2', userId: 'u-gasper', workOrderId: 'wo-134', kind: 'ISSUE', quantity: null, text: 'Manjka material: 20 mavčnih plošč', createdAt: minutesAgo(15) },
    { id: 'l-135-1', userId: 'u-blaz', workOrderId: 'wo-135', kind: 'ISSUE', quantity: null, text: 'Police niso dobavljene, dobava zamuja do petka.', createdAt: minutesAgo(70) },
  ];

  const summaries: DailySummary[] = [
    {
      id: `sum-u-gasper-${day(-1)}`,
      userId: 'u-gasper',
      date: day(-1),
      arrivalAt: at(-1, 7, 5),
      departureAt: at(-1, 15, 10),
      shiftMinutes: 485,
      orderMinutes: 0,
      lines: [
        {
          workOrderId: 'wo-134', code: '2026-00134', title: 'Mavčne stene', siteName: 'Poslovni objekt Lent · Maribor',
          minutes: 0, quantity: 0, unit: 'M2',
          workDone: 'Postavljena podkonstrukcija v pisarnah 1 in 2.',
          materialsUsed: [{ name: 'CW profili', qty: 64, unit: 'm' }],
          issues: [], photoCount: 0,
        },
      ],
      ordersWorked: ['2026-00134'],
      issuesReported: 0,
      photosTaken: 0,
      declaredEnd: false,
      corrections: [],
      comment: 'Podkonstrukcija pripravljena za oblaganje.',
      status: 'APPROVED',
      submittedAt: at(-1, 15, 15),
      reviewedAt: at(-1, 16, 0),
      reviewerName: 'Marko Vidmar',
      reviewerNote: null,
    },
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
          workOrderId: 'wo-130', code: '2026-00130', title: 'Hidroizolacija kleti', siteName: 'Hiša Novak · Ptuj',
          minutes: 340, quantity: 64, unit: 'M2',
          workDone: 'Položeni bitumenski trakovi na celotni vzhodni kletni steni, stiki zvarjeni in preverjeni.',
          materialsUsed: [{ name: 'Bitumenski trak', qty: 68, unit: 'm²' }],
          issues: [], photoCount: 0,
        },
      ],
      ordersWorked: ['2026-00130'],
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
      id: `sum-u-luka-${day(-1)}`,
      userId: DEMO_WORKER_ID,
      date: day(-1),
      arrivalAt: at(-1, 6, 58),
      departureAt: at(-1, 15, 31),
      shiftMinutes: 513,
      orderMinutes: 270,
      lines: [
        {
          workOrderId: 'wo-125', code: '2026-00125', title: 'Montaža stenskih elementov', siteName: 'Hiša Novak · Maribor',
          minutes: 270, quantity: 3, unit: 'PCS',
          workDone: 'Montirani trije stenski elementi na severni strani, poravnani in sidrani.',
          materialsUsed: [{ name: 'Vijaki M8x120', qty: 72, unit: 'kos' }],
          issues: ['Manjka material: 2 kosa OSB plošče'], photoCount: 0,
        },
      ],
      ordersWorked: ['2026-00125'],
      issuesReported: 1,
      photosTaken: 0,
      declaredEnd: false,
      corrections: [],
      comment: 'Za nadaljevanje potrebujemo 2 OSB plošči.',
      status: 'SUBMITTED',
      submittedAt: at(-1, 15, 35),
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
