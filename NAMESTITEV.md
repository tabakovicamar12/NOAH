# Namestitev AON: Supabase, Render ali Vercel

Ta navodila vas vodijo od praznega računa do delujoče aplikacije na spletu. Ključev nikoli ne pošiljajte po klepetu ali e-pošti. Vpišete jih v datoteko `.env` na svojem računalniku ali v nastavitve platforme.

---

## 1. Supabase (baza in fotografije)

1. Odprite **https://supabase.com** → **Start your project** in se prijavite (z GitHub ali e-pošto).
2. **New project**:
   - **Name:** `aon`
   - **Database password:** izmislite si močno geslo in **ga shranite** (upravitelj gesel). Potrebovali ga boste v koraku 3.
   - **Region:** **Central EU (Frankfurt)**. Zaradi GDPR podatki ostanejo v EU.
   - **Plan:** Free je dovolj za preizkus. Brezplačen projekt se po tednu dni brez uporabe ustavi; za pravo uporabo izberite **Pro**.
3. Ko je projekt pripravljen (1–2 minuti), potrebujete **tri stvari**:

| Kaj | Kje v Supabase | Spremenljivka |
|---|---|---|
| **Project URL** (`https://xxxx.supabase.co`) | Project Settings → **Data API** (ali gumb **Connect**) | `SUPABASE_URL` |
| **service_role / Secret key** | Project Settings → **API Keys** → *Secret key* (`sb_secret_…`) ali zavihek *Legacy* → `service_role` | `SUPABASE_SERVICE_ROLE_KEY` |
| **Connection string** | Gumb **Connect** (zgoraj) → *Connection string* → **Session pooler** → URI; `[YOUR-PASSWORD]` zamenjajte z geslom iz koraka 2 | `DATABASE_URL` |

> **Secret / service_role ključ** odpre vse podatke. Pozna ga lahko samo strežnik, nikoli aplikacija v brskalniku in nikoli git.

## 2. Datoteka `.env` na vašem računalniku

V mapi projekta kopirajte `.env.example` v `.env` in vpišite vrednosti:

```
DATABASE_URL=postgresql://postgres.xxxx:GESLO@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
JWT_SECRET=          # ustvarite z ukazom spodaj

# Podatki o delodajalcu (upravljavcu): v obvestilu o zasebnosti in na natisnjenih poročilih
ORG_NAME=NOAH d.o.o.
ORG_ADDRESS=Ulica 1, 2000 Maribor
ORG_TAX_ID=SI12345678
ORG_PRIVACY_CONTACT=zasebnost@noah.si
ORG_DPO=                 # pooblaščena oseba za varstvo podatkov, če je imenovana
PHOTO_RETENTION_DAYS=    # npr. 730; prazno = fotografije se ne brišejo samodejno
```

Vrednosti `ORG_*` zgoraj so samo primer; vpišite prave podatke podjetja. Dokler `ORG_NAME` ni nastavljen, je obvestilo o zasebnosti označeno kot vzorec.

Naključni `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Ko je `.env` izpolnjen, mi samo napišite »pripravljeno«.** Migracije in preizkus proti vaši bazi zaženem sam, ključi ostanejo na vašem računalniku.

## 3. Tabele in shramba fotografij

```bash
npm install
npm run cli -- migrate
```

Ta ukaz ustvari vse tabele, vklopi Row Level Security (javni Supabase API do tabel nima dostopa) in ustvari zasebno vedro **photos** za fotografije. V Supabase to preverite pod **Table Editor** in **Storage**.

Če ukazne vrstice ne želite uporabiti: `npm run cli -- sql` izpiše SQL, ki ga prilepite v Supabase → **SQL Editor** → Run.

## 4. Prvi računi, projekti in objekti

Gesla morajo imeti vsaj 10 znakov. Ukaz vas vpraša za geslo.

```bash
npm run cli -- create-user --username maja --name "Maja Vidic" --role MANAGER
npm run cli -- create-user --username luka --name "Luka Kranjc" --role WORKER --crew "Ekipa A"
npm run cli -- create-project --code HN --name "Hiša Novak"
npm run cli -- create-site --project HN --code HN-1 --name "Maribor, Tezno" --city Maribor
npm run cli -- list
```

Ostali ukazi:
- `set-password --username luka`: novo geslo
- `deactivate-user --username luka`: onemogoči prijavo; evidence ostanejo
- `grant-projects --username maja`: vodja lahko v aplikaciji (Projekti) dodaja projekte in objekte; `revoke-projects` to odvzame. Pri novem vodji lahko namesto tega dodate `--projects` k `create-user`. Vodja se mora po spremembi znova prijaviti.

> `seed-demo` naloži izmišljene demo podatke in **izbriše vse obstoječe**. Na pravi bazi ga ne uporabljajte.

## 5. Preizkus na vašem računalniku proti Supabase

```bash
npm run build
npm run start:prod
```

Odprite **http://localhost:8787**: to je točno to, kar bo tekel strežnik na Renderju.

---

## 6a. Objava na **Render** (priporočeno: ena storitev za aplikacijo in API)

1. Projekt mora biti v git repozitoriju na GitHubu (zasebnem). `.env` je v `.gitignore` in se ne objavi.
2. https://render.com → **New** → **Blueprint** → izberite repozitorij. Render prebere `render.yaml`.
3. Vpišite spremenljivke, označene kot *sync: false*:
   - `DATABASE_URL`: Session pooler (port **5432**)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

   `JWT_SECRET` Render ustvari sam.
4. **Deploy**. Ob zagonu strežnik sam zažene manjkajoče migracije.
5. Preverite: `https://<vaša-storitev>.onrender.com/api/v1/health` mora vrniti `{"ok":true,…}`.

## 6b. Objava na **Vercel**

1. https://vercel.com → **Add New → Project** → uvozite repozitorij. Nastavitve so v `vercel.json`, okvira ne izbirajte.
2. **Environment Variables**:
   - `DATABASE_URL`: enako kot zgoraj, **Session pooler** (port **5432**). Ne uporabite Transaction poolerja (port 6543): na njem vzporedne poizvedbe obvisijo.
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
   - `ORG_NAME`, `ORG_ADDRESS`, `ORG_TAX_ID`, `ORG_PRIVACY_CONTACT`, po potrebi `ORG_DPO` in `PHOTO_RETENTION_DAYS` (glej korak 2)
3. Migracije zaženite enkrat z vašega računalnika (korak 3); Vercel jih ne zaganja.
4. **Deploy** in preverite `/api/v1/health`.

> Na Vercelu je največja velikost zahtevka 4,5 MB. Aplikacija fotografije pomanjša na 2048 px (običajno 0,5–1,5 MB), strežnik pa sprejme do 4 MB.

---

## 7. Po objavi

- **HTTPS** je obvezen za kamero, mikrofon in namestitev PWA. Render in Vercel ga zagotovita samodejno.
- **Namestitev na telefon:**
  - Android Chrome: meni → *Namesti aplikacijo*
  - iPhone Safari: *Deli* → *Dodaj na začetni zaslon*
- **Posodobitve:** ob novi objavi aplikacija pokaže »Na voljo je nova različica AON« → *Posodobi*. Neposlani vnosi ostanejo na napravi.

## 8. GDPR: kaj mora urediti upravljavec (podjetje, ki uporablja AON)

- [ ] **Podatki o upravljavcu:** nastavite `ORG_NAME`, `ORG_ADDRESS`, `ORG_TAX_ID`, `ORG_PRIVACY_CONTACT` (in `ORG_DPO`, če ga imate). Prikažejo se v obvestilu o zasebnosti (`/privacy`) in na vseh natisnjenih poročilih ter evidencah. Besedilo obvestila naj pred uporabo pregleda pravnik ali pooblaščena oseba.
- [ ] **Pogodbe o obdelavi (DPA)** s Supabase, Render ali Vercel (vsi jih ponujajo v nastavitvah ali na spletni strani).
- [ ] **Roki hrambe:** določite rok za fotografije (`PHOTO_RETENTION_DAYS`) in ukaz `npm run cli:prod -- purge-photos` zaganjajte redno (npr. enkrat na teden); `--dry-run` samo prešteje. Evidenc delovnega časa ukaz ne briše: njihovo hrambo določa delovna zakonodaja.
- [ ] **Evidenca dejavnosti obdelave** in obvestilo zaposlenim.
- [ ] Glasovni vnos uporablja razpoznavanje govora brskalnika (Google, Apple). To je navedeno v obvestilu in v soglasju, ki ga delavec da pred prvo uporabo in ga lahko prekliče v meniju *Več*.

## Težave

| Težava | Rešitev |
|---|---|
| `DATABASE_URL must be set in production` | Spremenljivka ni nastavljena na platformi. |
| `password authentication failed` | Napačno geslo v `DATABASE_URL` ali pa niste zamenjali `[YOUR-PASSWORD]`. |
| Fotografije se ne naložijo | Preverite `SUPABASE_URL`, ključ in da obstaja vedro `photos` (`npm run cli -- migrate`). |
| Prijava: »Napačno uporabniško ime ali geslo« | `npm run cli -- list` pokaže račune; `set-password` nastavi novo geslo. |
| Po 10 napačnih prijavah | Počakajte 15 minut (zaščita pred ugibanjem gesel). |
