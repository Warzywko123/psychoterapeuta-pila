// Wspólne narzędzia API systemu rezerwacji.
// Plik z prefiksem "_" — Vercel nie wystawia go jako endpoint.
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

// Produkcja: Neon (HTTP driver). Lokalnie (PGLITE_DIR): PGlite — Postgres w procesie,
// ten sam interfejs tagged-template. Specyfikator w zmiennej, żeby bundler Vercela
// nie próbował pakować devDependency do funkcji produkcyjnych.
async function makeSql() {
  if (process.env.PGLITE_DIR) {
    const spec = '@electric-sql/pglite';
    const { PGlite } = await import(spec);
    const db = new PGlite(process.env.PGLITE_DIR);
    return async (strings, ...values) => {
      const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? '$' + (i + 1) : ''), '');
      return (await db.query(text, values)).rows;
    };
  }
  return neon(process.env.DATABASE_URL);
}

export const sql = await makeSql();

// Sloty rezerwowalne online od +24h do +4 tygodni. (Panel admina bez górnego limitu.)
export const MIN_LEAD_HOURS = 24;
export const MAX_DAYS_AHEAD = 28;

// Długość sesji terapeutycznej w minutach.
export const SLOT_MINUTES = 50;

// Domyślny grafik: klucz = dzień tygodnia JS (0=nd), wartość = lista początków wizyt
// w minutach od północy (700 = 11:40) lub null (dzień bez przyjęć online).
// Pn/wt/czw: 11:40, 12:50, 13:40, 14:30, 15:20 (sesje 50 min, przerwa 12:30–12:50).
const SESSIONS = [700, 770, 820, 870, 920];
const DEFAULT_SCHEDULE = { 0: null, 1: SESSIONS, 2: SESSIONS, 3: null, 4: SESSIONS, 5: null, 6: null };

let schemaReady;
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      // Budowanie schematu ma sens tylko przy pustej bazie: lokalny PGlite albo jednorazowa
      // migracja po zmianie struktury (ustaw MIGRATE=1 w zmiennych środowiskowych, wejdź
      // do panelu, skasuj zmienną). W produkcji tabele istnieją od dawna, a te kilkanaście
      // zapytań DDL wykonywało się przy każdym zimnym starcie funkcji i opóźniało
      // pierwsze wejście do panelu o ~1,5 s.
      if (!process.env.PGLITE_DIR && process.env.MIGRATE !== '1') return;

      await sql`CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        slot_date DATE NOT NULL,
        slot_min INT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        therapy TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot
        ON bookings (slot_date, slot_min) WHERE status = 'confirmed'`;
      await sql`CREATE TABLE IF NOT EXISTS blocks (
        id SERIAL PRIMARY KEY,
        slot_date DATE NOT NULL,
        slot_min INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (slot_date, slot_min)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS push_subs (
        id SERIAL PRIMARY KEY,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ip_hash TEXT`;
      // Rodzaj terapii już nie jest wybierany przy rezerwacji — kolumna zostaje
      // (stare dane), ale przestaje być wymagana. Drugi numer jest opcjonalny.
      await sql`ALTER TABLE bookings ALTER COLUMN therapy DROP NOT NULL`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS phone2 TEXT`;
      // Ręczne potwierdzenie wizyty przez pacjenta (mama zaznacza po odpowiedzi SMS).
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS patient_confirmed BOOLEAN NOT NULL DEFAULT false`;
      await sql`CREATE TABLE IF NOT EXISTS login_attempts (
        id SERIAL PRIMARY KEY,
        ip_hash TEXT NOT NULL,
        attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    })();
  }
  return schemaReady;
}

// Retencja RODO: dane rezerwacji znikają 7 dni po terminie wizyty. Warunek na
// slot_date < dziś - 7 dni dotyczy WYŁĄCZNIE minionych wizyt — przyszłe rezerwacje
// (umówione nawet 4 tygodnie naprzód) są nietknięte. Uruchamiane raz na dobę przez
// zaplanowane zadanie (patrz vercel.json) — wcześniej wisiało przy każdym zimnym
// starcie i wydłużało pierwsze wejście do panelu.
export async function purgeOldData() {
  const bookings = await sql`DELETE FROM bookings WHERE slot_date < CURRENT_DATE - INTERVAL '7 days' RETURNING id`;
  const blocks = await sql`DELETE FROM blocks WHERE slot_date < CURRENT_DATE - INTERVAL '60 days' RETURNING id`;
  const attempts = await sql`DELETE FROM login_attempts WHERE attempted_at < now() - INTERVAL '1 day' RETURNING id`;
  return { bookings: bookings.length, blocks: blocks.length, loginAttempts: attempts.length };
}

// Autoryzacja zaplanowanego zadania. Gdy ustawiony jest CRON_SECRET, Vercel dokłada
// do wywołań crona nagłówek "Authorization: Bearer <CRON_SECRET>". Porównanie w czasie
// stałym; brak sekretu = odmowa (fail closed). NIE ufamy nagłówkowi x-vercel-cron —
// jest w pełni podrabialny przez klienta, a repozytorium jest publiczne, więc każdy
// znałby ścieżkę crona i mógłby wywołać kasowanie danych.
export function isCronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.authorization || '');
  const good = Buffer.from(`Bearer ${secret}`);
  return given.length === good.length && crypto.timingSafeEqual(given, good);
}

// Grafik przyjęć: {dzieńTygodnia: [minutyStartu...] | null}.
export async function getSchedule() {
  const rows = await sql`SELECT value FROM settings WHERE key = 'schedule'`;
  if (rows.length) return rows[0].value;
  return DEFAULT_SCHEDULE;
}

// 700 -> "11:40"
export const minToHHMM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// "Teraz" jako zegar ścienny Warszawy przeniesiony w pola UTC — spójna arytmetyka bez pułapek stref.
export function warsawNowAsUTC() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute);
}

export function slotAsUTC(dateStr, min) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, min);
}

export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Odrzuca też nieistniejące daty kalendarzowe (np. 2026-07-32, 2026-13-01),
// które przechodzą regex, ale JS „rolluje" na inny dzień — sprawdzamy round-trip.
export const isValidDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

export function slotBookable(dateStr, min) {
  const now = warsawNowAsUTC();
  const slot = slotAsUTC(dateStr, min);
  return slot >= now + MIN_LEAD_HOURS * 3600e3 && slot <= now + MAX_DAYS_AHEAD * 86400e3;
}

// --- Sesja panelu: token "exp.podpisHMAC" w ciasteczku httpOnly ---
const COOKIE = 'dard_admin';
// Ważność sesji panelu. Po tylu dniach ciasteczko wygasa i trzeba zalogować się ponownie
// (skrócenie z 90 → 30 dni ogranicza okno użycia przechwyconego ciasteczka — panel z danymi
// o zdrowiu). „Wyloguj wszystkich" natychmiast = zmiana SESSION_SECRET w zmiennych środowiskowych.
const SESSION_DAYS = 30;

// Prefiks 'session:' oddziela ten HMAC od hasha IP (ten sam sekret, różne przeznaczenia)
// — separacja domenowa, żeby podpis sesji i hash IP nie dzieliły przestrzeni wartości.
function sign(exp) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update('session:' + exp).digest('base64url');
}

export function makeSessionCookie() {
  const exp = Date.now() + SESSION_DAYS * 86400e3;
  return `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearSessionCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function isAuthed(req) {
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

export function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  j(res, 401, { error: 'Wymagane logowanie' });
  return false;
}

export function j(res, code, obj) {
  res.status(code).setHeader('Cache-Control', 'no-store').json(obj);
}

// Zaufany adres klienta. NIE ufamy pierwszej wartości X-Forwarded-For — jest w pełni
// kontrolowana przez klienta (można ją sfałszować i obejść wszystkie limity per-IP).
// Vercel ustawia x-real-ip na prawdziwe IP klienta (nadpisuje wartość z żądania),
// a do x-forwarded-for DOPISUJE prawdziwe IP na KOŃCU — więc ostatni wpis jest zaufany.
export function clientIP(req) {
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (xff.length) return xff[xff.length - 1];
  return req.socket?.remoteAddress || 'unknown';
}

// Pseudonimizowany hash IP (RODO) — nie da się odtworzyć adresu, ale można liczyć limity.
export function ipHashOf(req) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update('iphash:' + clientIP(req)).digest('hex').slice(0, 32);
}

export function readBody(req) {
  // Uwaga: samo odczytanie req.body bywa getterem, który parsuje treść i RZUCA
  // przy niepoprawnym JSON — dlatego cały dostęp jest w try (inaczej handler
  // zwracał 500 zamiast kontrolowanego 400 dla śmieciowych żądań botów).
  try {
    if (req.body && typeof req.body === 'object') return req.body;
    return JSON.parse(req.body || '{}');
  } catch {
    return {};
  }
}

// --- 2FA: TOTP (RFC 6238), zgodny z Google Authenticator ---
// Sekret w base32 (env ADMIN_TOTP_SECRET). Kod 6-cyfrowy, okno 30 s, HMAC-SHA1.
// Zasada: z sekretu + numeru bieżącego 30-sekundowego okna liczymy 6 cyfr;
// aplikacja mamy liczy to samo niezależnie — jeśli kody się zgadzają, wpuszczamy.
function base32Decode(str) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) bits += A.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totpCode(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter)); // numer okna jako 64-bit big-endian
  const h = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const off = h[h.length - 1] & 0x0f; // dynamiczne obcięcie (RFC 4226)
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

// Sprawdza kod z tolerancją ±1 okno (30 s w tył/przód) na wypadek rozjazdu zegara.
export function verifyTOTP(secretB32, code) {
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length !== 6 || !secretB32) return false;
  const secret = base32Decode(secretB32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    const good = totpCode(secret, counter + w);
    if (crypto.timingSafeEqual(Buffer.from(good), Buffer.from(clean))) return true;
  }
  return false;
}

// --- Web Push do wszystkich zapisanych urządzeń (mama + Tymon) ---
export async function sendPushToAll(title, body) {
  const subs = await sql`SELECT id, endpoint, p256dh, auth FROM push_subs`;
  if (!subs.length) return;
  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'https://psychoterapeuta-pila.pl',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  const payload = JSON.stringify({ title, body });
  await Promise.allSettled(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await sql`DELETE FROM push_subs WHERE id = ${s.id}`;
      }
    }
  }));
}

const PL_DAYS = ['nd', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob'];
export function formatSlotPL(dateStr, min) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${PL_DAYS[weekdayOf(dateStr)]} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}, ${minToHHMM(min)}`;
}
