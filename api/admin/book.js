// POST /api/admin/book — ręczne wpisanie pacjenta (umówionego telefonicznie) przez panel.
// Wymaga sesji. Bez limitu 24h wyprzedzenia (można wpisać wizytę nawet na dziś),
// bez limitów IP/telefonu i bez push — wpis tworzy właściciel gabinetu.
import {
  ensureSchema, sql, getSchedule, isValidDate, weekdayOf, slotAsUTC, warsawNowAsUTC,
  THERAPIES, SLOT_MINUTES, requireAuth, j, readBody,
} from '../_lib.js';

const PHONE_THERAPY = 'Umówione telefonicznie';

export default async function handler(req, res) {
  if (req.method !== 'POST') return j(res, 405, { error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  try {
    await ensureSchema();
    const b = readBody(req);

    const date = b.date;
    const min = Number(b.min);
    if (!isValidDate(date) || !Number.isInteger(min)) return j(res, 400, { error: 'Nieprawidłowy termin.' });

    const starts = (await getSchedule())[weekdayOf(date)];
    if (!starts || !starts.includes(min)) {
      return j(res, 400, { error: 'Termin poza godzinami przyjęć.' });
    }
    // Dozwolona też trwająca sesja — blokujemy tylko sloty w pełni minione.
    if (slotAsUTC(date, min) + SLOT_MINUTES * 60e3 <= warsawNowAsUTC()) {
      return j(res, 400, { error: 'Ten termin już minął.' });
    }

    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 30) return j(res, 400, { error: 'Podaj imię i nazwisko pacjenta.' });

    let phone = String(b.phone || '').replace(/[\s\-().]/g, '').replace(/^\+?48/, '');
    if (phone && !/^\d{9}$/.test(phone)) return j(res, 400, { error: 'Telefon musi mieć 9 cyfr (albo zostaw puste).' });

    const therapy = THERAPIES.includes(b.therapy) ? b.therapy : PHONE_THERAPY;

    try {
      await sql`INSERT INTO bookings (slot_date, slot_min, name, phone, therapy)
        VALUES (${date}, ${min}, ${name}, ${phone}, ${therapy})`;
    } catch (err) {
      if (err.code === '23505') return j(res, 409, { error: 'Na ten termin jest już rezerwacja.' });
      throw err;
    }

    // Wpis się powiódł — dopiero teraz zdejmij ewentualną blokadę „pod tego pacjenta".
    // (Kolejność ważna: gdyby INSERT padł, blokada nie może zniknąć po cichu.)
    await sql`DELETE FROM blocks WHERE slot_date = ${date} AND slot_min = ${min}`;

    j(res, 200, { ok: true });
  } catch (err) {
    console.error('admin/book error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
