// POST /api/admin/cancel — odwołanie rezerwacji (wymaga sesji).
// Bez e-maili: panel przypomina, żeby zadzwonić do pacjenta.
import { ensureSchema, sql, getSchedule, weekdayOf, requireAuth, j, readBody } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return j(res, 405, { error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  try {
    await ensureSchema();
    const id = Number(readBody(req).id);
    if (!Number.isInteger(id)) return j(res, 400, { error: 'Nieprawidłowe id' });
    const rows = await sql`UPDATE bookings SET status = 'cancelled'
      WHERE id = ${id} AND status = 'confirmed' RETURNING phone, slot_date::text AS slot_date, slot_min`;
    if (!rows.length) return j(res, 404, { error: 'Nie znaleziono rezerwacji' });

    // Jeśli wszystkie pozostałe wolne sloty tego dnia są zablokowane (dzień urlopowy),
    // zablokuj też zwolniony slot — żeby nie wrócił cicho do sprzedaży online.
    const { slot_date: date, slot_min: min } = rows[0];
    const starts = (await getSchedule())[weekdayOf(date)];
    if (starts && starts.length) {
      const [{ bl }] = await sql`SELECT count(*)::int AS bl FROM blocks
        WHERE slot_date = ${date} AND slot_min = ANY(${starts})`;
      const [{ bk }] = await sql`SELECT count(*)::int AS bk FROM bookings
        WHERE slot_date = ${date} AND status = 'confirmed' AND slot_min = ANY(${starts})`;
      if (bl === starts.length - bk - 1) {
        await sql`INSERT INTO blocks (slot_date, slot_min) VALUES (${date}, ${min})
          ON CONFLICT (slot_date, slot_min) DO NOTHING`;
      }
    }

    j(res, 200, { ok: true, phone: rows[0].phone });
  } catch (err) {
    console.error('admin/cancel error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
