// GET /api/cron/cleanup — sprzątanie danych wg retencji RODO, raz na dobę (Vercel Cron).
// Dostęp: nagłówek Authorization z CRON_SECRET (jeśli ustawiony) albo znacznik crona Vercela.
import { purgeOldData, j } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return j(res, 405, { error: 'Method not allowed' });

  const secret = process.env.CRON_SECRET;
  const authorized = secret
    ? req.headers.authorization === `Bearer ${secret}`
    : req.headers['x-vercel-cron'] === '1';
  if (!authorized) return j(res, 401, { error: 'Brak uprawnień' });

  try {
    const removed = await purgeOldData();
    console.log('cron/cleanup:', removed);
    j(res, 200, { ok: true, removed });
  } catch (err) {
    console.error('cron/cleanup error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
