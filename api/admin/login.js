// POST /api/admin/login — hasło z env ADMIN_PASSWORD → ciasteczko sesji (90 dni).
// Rate limit: max 8 nieudanych prób na IP w ciągu 15 minut.
import crypto from 'node:crypto';
import { ensureSchema, sql, makeSessionCookie, j, readBody, ipHashOf } from '../_lib.js';

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

    const given = String(readBody(req).password || '');
    const good = process.env.ADMIN_PASSWORD || '';
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(good).digest();
    if (!good || !crypto.timingSafeEqual(a, b)) {
      await sql`INSERT INTO login_attempts (ip_hash) VALUES (${ipHash})`;
      await new Promise((r) => setTimeout(r, 600)); // spowolnienie zgadywania
      return j(res, 401, { error: 'Nieprawidłowe hasło' });
    }

    res.setHeader('Set-Cookie', makeSessionCookie());
    j(res, 200, { ok: true });
  } catch (err) {
    console.error('login error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
