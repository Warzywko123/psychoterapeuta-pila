// POST /api/admin/logout
import { clearSessionCookie, j } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return j(res, 405, { error: 'Method not allowed' });
  res.setHeader('Set-Cookie', clearSessionCookie());
  j(res, 200, { ok: true });
}
