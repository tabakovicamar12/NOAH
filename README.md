# AON

Terensko beleženje dela za NOAH: delovni nalogi, čas prihoda in odhoda, količine, fotografije, glasovni vnos in dnevna poročila. Deluje kot PWA (namesti se na telefon) in deluje tudi brez povezave.

- **Delavec** (telefon): ZAČNI DELO / KONČAJ DELO, nalogi, količine, opombe in problemi, fotografije, 🎤 GOVORI, dnevno poročilo.
- **Vodja** (računalnik ali tablica): pregled dneva, seznam projektov, nov delovni nalog, pregled in potrditev poročil, PDF.

## Sestava

| Del | Tehnologija | Mapa |
|---|---|---|
| Aplikacija (PWA) | Angular 22, Tailwind 4, Dexie (IndexedDB) | `src/` |
| Strežnik (API) | Node.js 20+, Hono | `server/` |
| Baza | PostgreSQL v Supabase (lokalno PGlite) | `server/migrations.ts` |
| Fotografije | Supabase Storage, zasebno vedro `photos` | `server/storage.ts` |
| Objava | Render (`render.yaml`) ali Vercel (`vercel.json`, `api/`) | |

Vsak vnos se najprej shrani na napravo in se sinhronizira, ko je povezava. Dogovor API je opisan v `src/app/core/models/api.models.ts`.

## Lokalni zagon

```bash
npm install
npm run cli -- seed-demo     # lokalna baza z izmišljenimi podatki (.data/pglite)
npm run dev:api              # API na http://localhost:8787
npm start                    # aplikacija na http://localhost:4200 (preusmeri /api na :8787)
```

Demo računi po `seed-demo`: vodja `vodja` / `vodja-demo-2026`, delavec `delavec` / `delavec-demo-2026`.

Predstavitev brez strežnika (vse v brskalniku): `npm run start:demo`.

Produkcijska gradnja, tako kot na Renderju: `npm run build` in nato `npm run start:prod` (http://localhost:8787 streže aplikacijo in API).

## Objava in Supabase

Korak za korakom: **[NAMESTITEV.md](NAMESTITEV.md)**.

## Skrbništvo (računi, projekti, objekti)

Računi se ustvarjajo z ukazi. Projekte in objekte lahko doda tudi vodja z dovoljenjem `grant-projects` (v aplikaciji: Projekti → Nov projekt / Nov objekt):

```bash
npm run cli -- create-user --username luka --name "Luka Kranjc" --role WORKER --crew "Ekipa A"
npm run cli -- create-project --code HN --name "Hiša Novak"
npm run cli -- create-site --project HN --code HN-1 --name "Maribor, Tezno" --city Maribor
npm run cli -- grant-projects --username maja
npm run cli -- list
```

Vsi ukazi: `npm run cli -- help`.

## Preverjanje

```bash
npm run typecheck            # TypeScript za aplikacijo in strežnik
npm run build                # aplikacija + strežnik
```
