// POST /api/admin/confirm — ręczne oznaczenie wizyty jako potwierdzonej/niepotwierdzonej
// przez pacjenta (mama zaznacza po otrzymaniu odpowiedzi SMS „TAK"). Wymaga sesji.
import { ensureSchema, sql, requireAuth, j, readBody } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return j(res, 405, { error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  try {
    await ensureSchema();
    const b = readBody(req);
    const id = Number(b.id);
    const confirmed = b.confirmed === true;
    if (!Number.isInteger(id)) return j(res, 400, { error: 'Nieprawidłowe id' });

    const rows = await sql`UPDATE bookings SET patient_confirmed = ${confirmed}
      WHERE id = ${id} AND status = 'confirmed' RETURNING id`;
    if (!rows.length) return j(res, 404, { error: 'Nie znaleziono rezerwacji' });

    j(res, 200, { ok: true, confirmed });
  } catch (err) {
    console.error('admin/confirm error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
