const { PGlite } = require("@electric-sql/pglite");
const { neon } = require("@neondatabase/serverless");
const fs = require("fs");

function prodUrl() {
  const line = fs.readFileSync("/Users/tymongrochowski/Projekty/psychoterapia-pila/.env.local", "utf8")
    .split("\n").find((l) => l.startsWith("DATABASE_URL="));
  return line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
}

const EXCLUDE_NAMES = new Set(["Jan Testowy"]); // moje testy z tej sesji, nie prawdziwi pacjenci

(async () => {
  const local = new PGlite("/Users/tymongrochowski/.pglite");
  const sql = neon(prodUrl());

  // --- 1. Grafik ---
  const scheduleRows = await local.query("SELECT value FROM settings WHERE key = $1", ["schedule"]);
  const schedule = scheduleRows.rows[0].value;
  await sql`INSERT INTO settings (key, value) VALUES ('schedule', ${JSON.stringify(schedule)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  console.log("Grafik przeniesiony:", JSON.stringify(schedule));

  // --- 2. Rezerwacje ---
  const bookingsRes = await local.query(
    "SELECT slot_date::text, slot_min, name, phone, therapy, status, created_at FROM bookings ORDER BY id"
  );
  let bookingsDone = 0, bookingsSkipped = 0;
  for (const b of bookingsRes.rows) {
    if (EXCLUDE_NAMES.has(b.name)) { bookingsSkipped++; continue; }
    await sql`INSERT INTO bookings (slot_date, slot_min, name, phone, therapy, status, created_at)
      VALUES (${b.slot_date}, ${b.slot_min}, ${b.name}, ${b.phone}, ${b.therapy}, ${b.status}, ${b.created_at})`;
    bookingsDone++;
  }
  console.log(`Rezerwacje: przeniesiono ${bookingsDone}, pominięto (test) ${bookingsSkipped}`);

  // --- 3. Blokady ---
  const blocksRes = await local.query("SELECT slot_date::text, slot_min FROM blocks ORDER BY slot_date, slot_min");
  let blocksDone = 0;
  for (const bl of blocksRes.rows) {
    await sql`INSERT INTO blocks (slot_date, slot_min) VALUES (${bl.slot_date}, ${bl.slot_min})
      ON CONFLICT (slot_date, slot_min) DO NOTHING`;
    blocksDone++;
  }
  console.log(`Blokady: przeniesiono ${blocksDone}`);

  // --- Weryfikacja ---
  const [{ c: bc }] = await sql`SELECT count(*)::int AS c FROM bookings WHERE status = 'confirmed'`;
  const [{ c: cc }] = await sql`SELECT count(*)::int AS c FROM bookings WHERE status = 'cancelled'`;
  const [{ c: blc }] = await sql`SELECT count(*)::int AS c FROM blocks`;
  console.log(`Weryfikacja na produkcji: potwierdzone=${bc}, anulowane=${cc}, blokady=${blc}`);
})().catch((e) => { console.error("BŁĄD:", e); process.exit(1); });
