// POST /api/book — utworzenie rezerwacji (auto-potwierdzenie).
import {
  ensureSchema, sql, getSchedule, isValidDate, slotBookable, weekdayOf,
  sendPushToAll, formatSlotPL, j, readBody, ipHashOf,
} from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return j(res, 405, { error: 'Method not allowed' });
  try {
    await ensureSchema();
    const b = readBody(req);

    // Honeypot — boty wypełniają ukryte pole; udajemy sukces.
    if (b.website) return j(res, 200, { ok: true });

    if (b.rodo !== true) return j(res, 400, { error: 'Wymagana zgoda na przetwarzanie danych.' });

    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 3 || name.length > 30 || !/\S+\s+\S+/.test(name)) {
      return j(res, 400, { error: 'Podaj imię i nazwisko.' });
    }
    if (!/^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]+$/.test(name)) {
      return j(res, 400, { error: 'Imię i nazwisko może zawierać tylko litery i spacje.' });
    }

    const phone = String(b.phone || '').replace(/[\s\-().]/g, '').replace(/^\+?48/, '');
    if (!/^\d{9}$/.test(phone)) {
      return j(res, 400, { error: 'Podaj poprawny 9-cyfrowy numer telefonu.' });
    }

    const phone2 = String(b.phone2 || '').replace(/[\s\-().]/g, '').replace(/^\+?48/, '');
    if (phone2 && !/^\d{9}$/.test(phone2)) {
      return j(res, 400, { error: 'Drugi numer telefonu musi mieć 9 cyfr (albo zostaw pole puste).' });
    }

    const date = b.date;
    const min = Number(b.min);
    if (!isValidDate(date) || !Number.isInteger(min)) return j(res, 400, { error: 'Nieprawidłowy termin.' });

    const starts = (await getSchedule())[weekdayOf(date)];
    if (!starts || !starts.includes(min) || !slotBookable(date, min)) {
      return j(res, 400, { error: 'Ten termin nie jest dostępny do rezerwacji online.' });
    }

    const blocked = await sql`SELECT 1 FROM blocks WHERE slot_date = ${date} AND slot_min = ${min}`;
    if (blocked.length) return j(res, 409, { error: 'Ten termin został właśnie zajęty. Wybierz inny.' });

    // Max 2 aktywne przyszłe rezerwacje na numer — ochrona przed spamem.
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM bookings
      WHERE phone = ${phone} AND status = 'confirmed' AND slot_date >= CURRENT_DATE`;
    if (count >= 2) {
      return j(res, 429, { error: 'Masz już aktywne rezerwacje. W sprawie kolejnych zadzwoń: 501 393 887.' });
    }

    // Max 3 rezerwacje dziennie z jednego IP — ochrona przed zablokowaniem kalendarza
    // fałszywymi wpisami z różnych numerów (slot-exhaustion attack).
    const ipHash = ipHashOf(req);
    const [{ count: ipCount }] = await sql`SELECT count(*)::int AS count FROM bookings
      WHERE ip_hash = ${ipHash} AND created_at > now() - INTERVAL '24 hours'`;
    if (ipCount >= 3) {
      return j(res, 429, { error: 'Limit rezerwacji online na dziś wyczerpany. Zadzwoń: 501 393 887.' });
    }

    try {
      await sql`INSERT INTO bookings (slot_date, slot_min, name, phone, phone2, ip_hash)
        VALUES (${date}, ${min}, ${name}, ${phone}, ${phone2 || null}, ${ipHash})`;
    } catch (err) {
      if (err.code === '23505') {
        return j(res, 409, { error: 'Ten termin został właśnie zajęty. Wybierz inny.' });
      }
      throw err;
    }

    const pretty = phone.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
    const pretty2 = phone2 ? ' / ' + phone2.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : '';
    await sendPushToAll('Nowa rezerwacja — DARD', `${formatSlotPL(date, min)} · ${name} · tel. ${pretty}${pretty2}`);

    j(res, 200, { ok: true });
  } catch (err) {
    console.error('book error:', err);
    j(res, 500, { error: 'Błąd serwera. Spróbuj ponownie lub zadzwoń: 501 393 887.' });
  }
}
