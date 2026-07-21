// GET /api/admin/data?start=YYYY-MM-DD — dane tygodnia dla panelu (wymaga sesji).
// GET /api/admin/data?cron=cleanup — sprzątanie wg retencji RODO (Vercel Cron, raz na dobę).
import { ensureSchema, sql, getSchedule, isValidDate, weekdayOf, requireAuth, purgeOldData, isCronAuthorized, j } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return j(res, 405, { error: 'Method not allowed' });

  // Sprzątanie doklejone tutaj, a nie jako osobna funkcja, bo plan Hobby dopuszcza
  // najwyżej 12 funkcji na wdrożenie — a tyle już mamy. Kasowane są wyłącznie dane
  // przeterminowane (wizyty >7 dni po terminie, blokady >60 dni, próby logowania >1 doba).
  if (req.query.cron === 'cleanup') {
    if (!isCronAuthorized(req)) return j(res, 401, { error: 'Brak uprawnień' });
    try {
      await ensureSchema();
      const removed = await purgeOldData();
      console.log('cleanup RODO:', removed);
      return j(res, 200, { ok: true, removed });
    } catch (err) {
      console.error('cleanup error:', err);
      return j(res, 500, { error: 'Błąd serwera' });
    }
  }

  if (!requireAuth(req, res)) return;
  try {
    await ensureSchema();
    const start = req.query.start;
    if (!isValidDate(start) || weekdayOf(start) !== 1) {
      return j(res, 400, { error: 'Parametr start musi być poniedziałkiem' });
    }
    const [y, m, d] = start.split('-').map(Number);
    const end = new Date(Date.UTC(y, m - 1, d + 6)).toISOString().slice(0, 10);

    const bookings = await sql`SELECT id, slot_date::text AS slot_date, slot_min, name, phone, phone2, patient_confirmed, created_at
      FROM bookings WHERE status = 'confirmed' AND slot_date BETWEEN ${start} AND ${end}
      ORDER BY slot_date, slot_min`;

    const blocks = await sql`SELECT slot_date::text AS slot_date, slot_min FROM blocks
      WHERE slot_date BETWEEN ${start} AND ${end}`;

    const upcoming = await sql`SELECT id, slot_date::text AS slot_date, slot_min, name, phone, phone2, patient_confirmed
      FROM bookings WHERE status = 'confirmed' AND slot_date >= CURRENT_DATE
      ORDER BY slot_date, slot_min LIMIT 20`;

    j(res, 200, {
      schedule: await getSchedule(),
      bookings,
      blocks,
      upcoming,
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    });
  } catch (err) {
    console.error('admin/data error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
