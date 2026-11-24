// Autenticación sin dependencias extra: scrypt para contraseñas + cookie firmada (HMAC)
const crypto = require('crypto');
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const firmar = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');

function hashPass(p) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex');
}
function verificarPass(p, h) {
  const [salt, key] = (h || '').split(':');
  if (!salt || !key) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(p, salt, 64), Buffer.from(key, 'hex'));
}
function iniciarSesion(res, u) {
  const payload = Buffer.from(JSON.stringify({ e: u.email, n: u.nombre, r: u.rol, x: Date.now() + 8 * 3600e3 })).toString('base64url');
  res.cookie('sesion', payload + '.' + firmar(payload), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600e3 });
}
function leerSesion(req) {
  const m = /(?:^|;\s*)sesion=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const esperado = firmar(payload);
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return d.x > Date.now() ? d : null;
  } catch { return null; }
}
function requerirLogin(req, res, next) {
  const s = leerSesion(req);
  if (!s) return res.redirect('/login');
  res.locals.usuario = { email: s.e, nombre: s.n, rol: s.r };
  next();
}
module.exports = { hashPass, verificarPass, iniciarSesion, leerSesion, requerirLogin };
