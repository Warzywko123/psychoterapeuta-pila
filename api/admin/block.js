// POST /api/admin/block — blokowanie/odblokowanie slotu lub całego dnia (wymaga sesji).
// action: 'block' | 'unblock' (z min) | 'block-day' | 'unblock-day'
import { ensureSchema, sql, getSchedule, isValidDate, weekdayOf, requireAuth, j, readBody } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return j(res, 405, { error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  try {
    await ensureSchema();
    const { date, min, action } = readBody(req);
    if (!isValidDate(date)) return j(res, 400, { error: 'Nieprawidłowa data' });

    if (action === 'block' || action === 'unblock') {
      const m = Number(min);
      if (!Number.isInteger(m) || m < 0 || m > 1439) return j(res, 400, { error: 'Nieprawidłowa godzina' });
      if (action === 'block') {
        const busy = await sql`SELECT 1 FROM bookings
          WHERE slot_date = ${date} AND slot_min = ${m} AND status = 'confirmed'`;
        if (busy.length) return j(res, 409, { error: 'Na ten termin jest rezerwacja — najpierw ją odwołaj.' });
        await sql`INSERT INTO blocks (slot_date, slot_min) VALUES (${date}, ${m})
          ON CONFLICT (slot_date, slot_min) DO NOTHING`;
      } else {
        await sql`DELETE FROM blocks WHERE slot_date = ${date} AND slot_min = ${m}`;
      }
      return j(res, 200, { ok: true });
    }

    if (action === 'block-day') {
      const starts = (await getSchedule())[weekdayOf(date)];
      for (const m of starts || []) {
        const busy = await sql`SELECT 1 FROM bookings
          WHERE slot_date = ${date} AND slot_min = ${m} AND status = 'confirmed'`;
        if (!busy.length) {
          await sql`INSERT INTO blocks (slot_date, slot_min) VALUES (${date}, ${m})
            ON CONFLICT (slot_date, slot_min) DO NOTHING`;
        }
      }
      return j(res, 200, { ok: true });
    }

    if (action === 'unblock-day') {
      await sql`DELETE FROM blocks WHERE slot_date = ${date}`;
      return j(res, 200, { ok: true });
    }

    j(res, 400, { error: 'Nieznana akcja' });
  } catch (err) {
    console.error('admin/block error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
