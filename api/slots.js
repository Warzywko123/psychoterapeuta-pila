// GET /api/slots?start=YYYY-MM-DD (poniedziałek tygodnia)
// Publiczny — zwraca tylko dostępny/niedostępny, bez powodu (prywatność).
import { ensureSchema, sql, getSchedule, isValidDate, slotBookable, weekdayOf, minToHHMM, j } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return j(res, 405, { error: 'Method not allowed' });
  try {
    await ensureSchema();
    const start = req.query.start;
    if (!isValidDate(start) || weekdayOf(start) !== 1) {
      return j(res, 400, { error: 'Parametr start musi być poniedziałkiem (YYYY-MM-DD)' });
    }

    const [y, m, d] = start.split('-').map(Number);
    const dates = Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(Date.UTC(y, m - 1, d + i));
      return dt.toISOString().slice(0, 10);
    });
    const end = dates[6];

    const schedule = await getSchedule();
    const taken = new Set();
    const booked = await sql`SELECT slot_date::text AS slot_date, slot_min FROM bookings
      WHERE status = 'confirmed' AND slot_date BETWEEN ${start} AND ${end}`;
    const blocked = await sql`SELECT slot_date::text AS slot_date, slot_min FROM blocks
      WHERE slot_date BETWEEN ${start} AND ${end}`;
    for (const r of [...booked, ...blocked]) {
      taken.add(`${r.slot_date}|${r.slot_min}`);
    }

    const days = dates.map((date) => {
      const starts = schedule[weekdayOf(date)];
      const slots = (starts || []).map((min) => ({
        min,
        time: minToHHMM(min),
        available: slotBookable(date, min) && !taken.has(`${date}|${min}`),
      }));
      return { date, slots };
    });

    j(res, 200, { days });
  } catch (err) {
    console.error('slots error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
