// POST /api/push/subscribe — zapis subskrypcji push urządzenia (wymaga sesji).
import { ensureSchema, sql, requireAuth, j, readBody } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return j(res, 405, { error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  try {
    await ensureSchema();
    const { subscription, label } = readBody(req);
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;
    if (!endpoint || !p256dh || !auth) return j(res, 400, { error: 'Nieprawidłowa subskrypcja' });
    await sql`INSERT INTO push_subs (endpoint, p256dh, auth, label)
      VALUES (${endpoint}, ${p256dh}, ${auth}, ${String(label || '').slice(0, 80)})
      ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`;
    j(res, 200, { ok: true });
  } catch (err) {
    console.error('push/subscribe error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
