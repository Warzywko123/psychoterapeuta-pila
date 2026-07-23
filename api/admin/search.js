// GET /api/admin/search?q=... — szukanie pacjenta po imieniu/nazwisku lub telefonie (wymaga sesji).
// Przeszukuje całą tabelę. Uwaga: retencja RODO (purgeOldData w _lib.js) kasuje rezerwacje
// 7 dni po terminie wizyty, więc w historii są tylko wizyty z mniej więcej ostatniego tygodnia.
import { ensureSchema, sql, requireAuth, j } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return j(res, 405, { error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  try {
    await ensureSchema();
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return j(res, 200, { upcoming: [], past: [] });

    // Sam numer (min. 3 cyfry, zero liter) → szukamy po telefonie; cokolwiek innego → po nazwisku.
    // % i _ tracą znaczenie wzorca, żeby wpisanie "%" nie wyciągnęło całej bazy.
    const digits = q.replace(/\D/g, '');
    const byPhone = digits.length >= 3 && !/[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(q);
    const namePat = byPhone ? '' : '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const phonePat = byPhone ? '%' + digits + '%' : '';

    // Nadchodzące rosnąco (najbliższa wizyta na górze), historia malejąco (ostatnia na górze).
    const upcoming = await sql`SELECT id, slot_date::text AS slot_date, slot_min, name, phone, phone2, status, patient_confirmed
      FROM bookings WHERE slot_date >= CURRENT_DATE AND (
        (${namePat}::text <> '' AND name ILIKE ${namePat})
        OR (${phonePat}::text <> '' AND (phone LIKE ${phonePat} OR COALESCE(phone2, '') LIKE ${phonePat})))
      ORDER BY slot_date, slot_min LIMIT 30`;

    const past = await sql`SELECT id, slot_date::text AS slot_date, slot_min, name, phone, phone2, status, patient_confirmed
      FROM bookings WHERE slot_date < CURRENT_DATE AND (
        (${namePat}::text <> '' AND name ILIKE ${namePat})
        OR (${phonePat}::text <> '' AND (phone LIKE ${phonePat} OR COALESCE(phone2, '') LIKE ${phonePat})))
      ORDER BY slot_date DESC, slot_min DESC LIMIT 30`;

    j(res, 200, { upcoming, past });
  } catch (err) {
    console.error('admin/search error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
