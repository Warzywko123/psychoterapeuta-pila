// POST /api/admin/block — zarządzanie wyjątkami w kalendarzu (wymaga sesji):
//  - blokady (zdejmują termin):   'block' | 'unblock' (z min) | 'block-day' | 'unblock-day'
//  - jednorazowe wolne okienka:   'extra-add' | 'extra-remove' (z min) — poza stałym grafikiem
import { ensureSchema, sql, getSchedule, isValidDate, weekdayOf, minToHHMM, SLOT_MINUTES, requireAuth, j, readBody } from '../_lib.js';

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
      // Zdejmujemy nie tylko stały grafik, ale też jednorazowe okienka dodane na ten dzień —
      // wcześniej „Zablokuj dzień" (urlop) ich nie dotykało i pacjent mógł się na nie zapisać
      // mimo zamkniętego dnia. Blokujemy, a nie kasujemy okienko, żeby „Odblokuj dzień"
      // (które usuwa blokady tej daty) przywróciło dzień dokładnie do stanu sprzed blokady.
      const starts = (await getSchedule())[weekdayOf(date)] || [];
      const extra = await sql`SELECT slot_min FROM extra_slots WHERE slot_date = ${date}`;
      for (const m of new Set([...starts, ...extra.map((r) => r.slot_min)])) {
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

    // Jednorazowe wolne okienko poza stałym grafikiem (np. dodatkowa godzina w dany dzień).
    if (action === 'extra-add' || action === 'extra-remove') {
      const m = Number(min);
      if (!Number.isInteger(m) || m < 360 || m > 1380) {
        return j(res, 400, { error: 'Godzina poza zakresem 6:00–23:00.' });
      }
      if (action === 'extra-add') {
        // Okienko tylko w dzień, w którym gabinet i tak przyjmuje (dodatkowa godzina),
        // nie w dni wolne — w niedzielę/dzień nieczynny strona rezerwacji i tak by go nie pokazała.
        const starts = (await getSchedule())[weekdayOf(date)] || [];
        if (!starts.length) {
          return j(res, 400, { error: 'W ten dzień gabinet jest nieczynny — okienko można dodać tylko w dzień przyjęć.' });
        }
        // Nie dubluj godziny, która już jest w stałym grafiku tego dnia.
        if (starts.includes(m)) {
          return j(res, 409, { error: 'Ta godzina jest już w stałym grafiku tego dnia.' });
        }
        // Sesja trwa 50 minut, więc sam brak duplikatu godziny nie wystarczy — okienko musi
        // mieć pełny odstęp od KAŻDEJ innej wizyty tego dnia. Bez tego dało się dodać 12:00
        // obok grafikowego 11:40 i dwie osoby rezerwowały nachodzące na siebie sesje.
        const otherExtra = await sql`SELECT slot_min FROM extra_slots WHERE slot_date = ${date}`;
        const otherBooked = await sql`SELECT slot_min FROM bookings
          WHERE slot_date = ${date} AND status = 'confirmed'`;
        const occupied = [...starts, ...otherExtra.map((r) => r.slot_min), ...otherBooked.map((r) => r.slot_min)];
        const clash = occupied.find((s) => Math.abs(s - m) < SLOT_MINUTES);
        if (clash !== undefined) {
          return j(res, 409, clash === m
            ? { error: 'Ta godzina jest już zajęta w tym dniu.' }
            : { error: `Ta godzina nachodzi na wizytę o ${minToHHMM(clash)} — sesja trwa ${SLOT_MINUTES} min.` });
        }
        await sql`INSERT INTO extra_slots (slot_date, slot_min) VALUES (${date}, ${m})
          ON CONFLICT (slot_date, slot_min) DO NOTHING`;
      } else {
        await sql`DELETE FROM extra_slots WHERE slot_date = ${date} AND slot_min = ${m}`;
      }
      return j(res, 200, { ok: true });
    }

    j(res, 400, { error: 'Nieznana akcja' });
  } catch (err) {
    console.error('admin/block error:', err);
    j(res, 500, { error: 'Błąd serwera' });
  }
}
