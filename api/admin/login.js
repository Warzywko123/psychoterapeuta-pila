// POST /api/admin/login — hasło z env ADMIN_PASSWORD + kod TOTP → ciasteczko sesji
// (długość sesji: SESSION_DAYS w _lib.js). Rate limit: max 8 nieudanych prób na IP
// w ciągu 15 minut. Bez ADMIN_TOTP_SECRET logowanie jest zablokowane (fail closed).
import crypto from 'node:crypto';
import { ensureSchema, sql, makeSessionCookie, j, readBody, ipHashOf, verifyTOTP } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return j(res, 405, { error: 'Method not allowed' });
  try {
    await ensureSchema();
    const ipHash = ipHashOf(req);

    const [{ count }] = await sql`SELECT count(*)::int AS count FROM login_attempts
      WHERE ip_hash = ${ipHash} AND attempted_at > now() - INTERVAL '15 minutes'`;
    if (count >= 8) {
      return j(res, 429, { error: 'Zbyt wiele prób logowania. Spróbuj za 15 minut.' });
    }

    // 2FA jest obowiązkowe. Gdyby ADMIN_TOTP_SECRET zniknął ze zmiennych środowiskowych,
    // panel MUSI przestać wpuszczać kogokolwiek — wcześniej brak sekretu po cichu
    // przełączał logowanie na samo hasło i nic tego nie sygnalizowało. Fail closed:
    // wolimy zablokowany panel (do naprawienia zmienną w Vercelu) niż panel z danymi
    // pacjentów chroniony jednym hasłem bez wiedzy właściciela.
    const totpSecret = process.env.ADMIN_TOTP_SECRET || '';
    if (!totpSecret) {
      console.error('login: brak ADMIN_TOTP_SECRET — logowanie zablokowane (fail closed)');
      return j(res, 503, { error: 'Panel chwilowo niedostępny — brak konfiguracji 2FA. Skontaktuj się z administratorem.' });
    }

    const body = readBody(req);
    const given = String(body.password || '');
    const good = process.env.ADMIN_PASSWORD || '';
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(good).digest();
    const passOk = !!good && crypto.timingSafeEqual(a, b);

    const totpOk = verifyTOTP(totpSecret, body.totp);

    // Sprawdzamy oba naraz i zwracamy jeden ogólny błąd — nie zdradzamy,
    // czy pomylono hasło czy kod (żeby nie ułatwiać zgadywania).
    if (!passOk || !totpOk) {
      await sql`INSERT INTO login_attempts (ip_hash) VALUES (${ipHash})`;
      await new Promise((r) => setTimeout(r, 600)); // spowolnienie zgadywania
      return j(res, 401, { error: 'Nieprawidłowe hasło lub kod' });
    }

    res.setHeader('Set-Cookie', makeSessionCookie());
    j(res, 200, { ok: true });
  } catch (err) {
    console.error('login error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
