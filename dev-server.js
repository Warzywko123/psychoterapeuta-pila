// Lokalny serwer deweloperski — statyczne pliki + API z /api (te same handlery co Vercel).
// Uruchomienie: node dev-server.js  (wymaga .env.local z PGLITE_DIR itd.)
// NIE jest używany na produkcji.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

// --- Wczytaj .env.local (bez zależności od dotenv) ---
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

// PGLITE_DIR bywa ścieżką względną — jeśli proces wystartuje z innego katalogu
// roboczego niż ROOT (np. z narzędzia podglądu), baza wylądowałaby gdzie indziej
// (np. w katalogu domowym). Zawsze kotwiczymy ją w katalogu projektu.
if (process.env.PGLITE_DIR && !path.isAbsolute(process.env.PGLITE_DIR)) {
  process.env.PGLITE_DIR = path.join(ROOT, process.env.PGLITE_DIR);
}

// Ta sama polityka CSP co w vercel.json — powielona tutaj, żeby dało się
// przetestować lokalnie (dev-server nie czyta vercel.json). Trzymać w zgodzie z vercel.json.
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https://www.googletagmanager.com https://www.google-analytics.com https://region1.google-analytics.com; connect-src 'self' https://www.googletagmanager.com https://www.google-analytics.com https://region1.google-analytics.com https://*.analytics.google.com; frame-src https://*.google.com";

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function shimRes(res) {
  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = (k, v) => {
    // Lokalnie (http://) przeglądarka może odrzucić ciasteczko z flagą Secure — zdejmujemy ją tylko w dev.
    if (String(k).toLowerCase() === 'set-cookie') v = String(v).replace('; Secure', '');
    origSetHeader(k, v);
    return res;
  };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

async function readJSONBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return raw; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  // Nagłówki bezpieczeństwa (jak vercel.json) — na potrzeby lokalnych testów CSP.
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  // --- API ---
  if (pathname.startsWith('/api/')) {
    const modPath = path.join(ROOT, pathname.replace(/\/$/, '') + '.js');
    if (!modPath.startsWith(path.join(ROOT, 'api')) || !fs.existsSync(modPath)) {
      shimRes(res).status(404).json({ error: 'Not found' });
      return;
    }
    try {
      // Symulacja zaufanego proxy (jak Vercel): nadpisz x-real-ip prawdziwym IP gniazda,
      // ignorując wartość podaną przez klienta. Dzięki temu spoofing X-Forwarded-For
      // nie obchodzi limitów — tak jak na produkcji.
      req.headers['x-real-ip'] = req.socket.remoteAddress || '127.0.0.1';
      req.query = Object.fromEntries(url.searchParams);
      if (req.method !== 'GET' && req.method !== 'HEAD') req.body = await readJSONBody(req);
      const mod = await import(modPath);
      await mod.default(req, shimRes(res));
    } catch (err) {
      console.error(`[api] ${pathname}:`, err);
      if (!res.headersSent) shimRes(res).status(500).json({ error: 'Dev server error: ' + err.message });
    }
    return;
  }

  // --- Pliki statyczne ---
  let filePath = path.normalize(path.join(ROOT, pathname === '/' ? 'index.html' : pathname));
  if (!filePath.startsWith(ROOT)) { res.statusCode = 403; res.end('Forbidden'); return; }
  // Blokada dot-plików i dot-katalogów (.env.local, .git, .pglite itd.)
  if (path.relative(ROOT, filePath).split(path.sep).some((p) => p.startsWith('.'))) {
    res.statusCode = 403; res.end('Forbidden'); return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  res.statusCode = 404;
  const notFound = path.join(ROOT, '404.html');
  if (fs.existsSync(notFound)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    fs.createReadStream(notFound).pipe(res);
  } else {
    res.end('404');
  }
});

server.listen(PORT, () => {
  console.log(`✓ DEV: http://localhost:${PORT}  (baza: ${process.env.PGLITE_DIR ? 'PGlite ' + process.env.PGLITE_DIR : 'Neon'})`);
});
