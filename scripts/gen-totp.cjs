// Jednorazowa konfiguracja 2FA (TOTP) dla panelu admina.
// Uruchom lokalnie:  node scripts/gen-totp.cjs
//
// Skrypt:
//   1) generuje losowy sekret 2FA,
//   2) pokazuje kod QR do zeskanowania w aplikacji (Google Authenticator / Authy) na telefonie mamy,
//   3) wypisuje sekret do wpisania w ADMIN_TOTP_SECRET (lokalnie w .env.local ORAZ w Vercel).
//
// „Reset przez Ciebie": gdy mama zgubi/wymieni telefon — uruchom skrypt ponownie,
// podmień ADMIN_TOTP_SECRET (lokalnie + Vercel), redeploy i pokaż nowy QR do zeskanowania.
const crypto = require('node:crypto');

// Losowy sekret 20 bajtów → base32 (format oczekiwany przez aplikacje authenticatora).
function base32Encode(buf) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5), 2)];
  const rem = bits.length % 5;
  if (rem) out += A[parseInt(bits.slice(bits.length - rem).padEnd(5, '0'), 2)];
  return out;
}

const secret = base32Encode(crypto.randomBytes(20));
const label = encodeURIComponent('Panel DARD (mama)');
const issuer = encodeURIComponent('Gabinet Psychoterapii DARD');
const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30&algorithm=SHA1`;

console.log('\n=== Konfiguracja 2FA panelu DARD ===\n');

let qrShown = false;
try {
  const qrcode = require('qrcode');
  qrcode.toString(uri, { type: 'terminal', small: true }, (err, str) => {
    if (!err) { console.log(str); qrShown = true; }
    finish();
  });
} catch {
  finish();
}

function finish() {
  if (!qrShown) {
    console.log('(kod QR wymaga: npm i -D qrcode — wtedy uruchom skrypt ponownie)\n');
    console.log('Link otpauth (można wkleić do generatora QR albo dodać ręcznie w aplikacji):');
    console.log('  ' + uri + '\n');
  }
  console.log('SEKRET (do wpisania ręcznego w aplikacji, gdyby QR nie działał):');
  console.log('  ' + secret + '\n');
  console.log('DODAJ do .env.local (lokalnie) ORAZ do Vercel (production):');
  console.log('  ADMIN_TOTP_SECRET=' + secret + '\n');
  console.log('Vercel:  npx vercel env add ADMIN_TOTP_SECRET production');
  console.log('Po wpisaniu sekretu i redeployu panel zacznie wymagać kodu z aplikacji.\n');
}
