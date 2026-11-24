// Avisos por correo: préstamos que vencen en los próximos días (se envía una sola vez por préstamo)
const nodemailer = require('nodemailer');
const { getDb } = require('./db');
const { MULTA_DIA } = require('./config');

const DIA = 864e5;
const listo = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let transporter;
const puerto = () => Number(process.env.SMTP_PORT || 465);
const tx = () => (transporter ||= nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: puerto(), secure: puerto() === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}));

function plantilla(p) {
  const limite = new Date(p.fecha_limite).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  return {
    asunto: `📚 Tu préstamo vence el ${limite}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#4f46e5;color:#fff;padding:18px 22px;font-size:20px">📚 Biblioteca</div>
      <div style="padding:22px;color:#0f172a">
        <p>Hola <b>${esc(p.socio.nombre)}</b>,</p>
        <p>Te recordamos que el libro <b>«${esc(p.libro.titulo)}»</b> vence el <b>${limite}</b>.</p>
        <p>Devuélvelo a tiempo o renuévalo en la biblioteca. Pasada la fecha se cobra una multa de <b>$${MULTA_DIA} por día</b> de retraso.</p>
        <p style="color:#64748b;font-size:13px">Este es un aviso automático, no respondas a este mensaje.</p>
      </div></div>`
  };
}

async function enviarAvisos() {
  if (!listo()) return { enviados: 0, omitidos: 0, fallos: 0, error: 'Falta configurar el correo (SMTP) en el archivo .env' };
  const db = await getDb();
  const ahora = new Date();
  const dias = Number(process.env.AVISO_DIAS || 2);
  const lista = await db.collection('prestamos').aggregate([
    { $match: { estado: 'activo', aviso_enviado: { $exists: false }, fecha_limite: { $gte: ahora, $lt: new Date(ahora.getTime() + dias * DIA) } } },
    { $lookup: { from: 'socios', localField: 'socio_id', foreignField: '_id', as: 'socio' } },
    { $lookup: { from: 'libros', localField: 'libro_id', foreignField: '_id', as: 'libro' } },
    { $unwind: '$socio' }, { $unwind: '$libro' }
  ]).toArray();

  let enviados = 0, omitidos = 0, fallos = 0;
  for (const p of lista) {
    if (/@correo\.com$/i.test(p.socio.email)) { omitidos++; continue; } // correos falsos del seed: no se envía nada
    try {
      const { asunto, html } = plantilla(p);
      await tx().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: p.socio.email, subject: asunto, html });
      await db.collection('prestamos').updateOne({ _id: p._id }, { $set: { aviso_enviado: new Date() } });
      enviados++;
    } catch (e) { fallos++; console.error('Aviso fallido para', p.socio.email, '->', e.message); }
  }
  return { enviados, omitidos, fallos };
}

module.exports = { enviarAvisos, listo, plantilla };
