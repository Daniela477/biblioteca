require('dotenv').config();
const express = require('express');
const path = require('path');
const { getDb, ObjectId } = require('./db');
const { CATEGORIAS, TIPOS_SOCIO, CIUDADES, MULTA_DIA, MAX_ACTIVOS, MAX_RENOVACIONES } = require('./config');
const pipelines = require('./pipelines');
const { enviarAvisos, listo: correoListo } = require('./avisos');
const { hashPass, verificarPass, iniciarSesion, leerSesion, requerirLogin } = require('./auth');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.locals.ok = req.query.ok || null;
  res.locals.error = req.query.error || null;
  res.locals.ruta = req.path;
  res.locals.usuario = null;
  res.locals.fmt = d => (d ? new Date(d).toISOString().slice(0, 10) : '—');
  next();
});

// ---------- utilidades ----------
const DIA = 86400000;
const w = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const oid = id => (/^[a-f0-9]{24}$/i.test(id || '') ? new ObjectId(id) : null);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lista = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
const go = (res, base, tipo, msg) => res.redirect(`${base}?${tipo}=${encodeURIComponent(msg)}`);
const ETIQUETAS = [
  [/etiquetas\/quitar$/, 'Quitó una etiqueta'], [/etiquetas$/, 'Agregó una etiqueta'],
  [/^\/libros$/, 'Creó un libro'], [/^\/libros\/[a-f0-9]{24}$/, 'Editó un libro'], [/^\/libros\/.+\/eliminar$/, 'Eliminó un libro'],
  [/^\/socios$/, 'Creó un socio'], [/^\/socios\/[a-f0-9]{24}$/, 'Editó un socio'], [/^\/socios\/.+\/eliminar$/, 'Eliminó un socio'],
  [/^\/prestamos$/, 'Registró un préstamo'], [/devolver$/, 'Registró una devolución'], [/renovar$/, 'Renovó un préstamo'],
  [/^\/prestamos\/.+\/eliminar$/, 'Eliminó un préstamo'], [/^\/admin\/usuarios$/, 'Creó un usuario'], [/^\/admin\/avisos$/, 'Envió avisos de vencimiento por correo']
];
const POR_PAG = 25;
const pager = (req, total) => {
  const q = new URLSearchParams(req.query); q.delete('p');
  return { p: Math.max(1, parseInt(req.query.p, 10) || 1), paginas: Math.max(1, Math.ceil(total / POR_PAG)), total, qs: q.toString() };
};
const fecha = d => (d ? new Date(d).toISOString().slice(0, 10) : '');
const csv = (res, nombre, filas) => {
  const e = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nombre}"` });
  res.send('\ufeff' + filas.map(f => f.map(e).join(';')).join('\r\n'));
};
const LOOKUPS = [
  { $lookup: { from: 'socios', localField: 'socio_id', foreignField: '_id', as: 'socio' } },
  { $lookup: { from: 'libros', localField: 'libro_id', foreignField: '_id', as: 'libro' } },
  { $unwind: '$socio' }, { $unwind: '$libro' }
];
const errMsg = e =>
  e.code === 11000 ? 'Ya existe un registro con ese valor único (ISBN, documento o correo).'
  : e.code === 121 ? 'MongoDB rechazó el documento: no cumple el esquema ($jsonSchema).'
  : e.message;

// =====================================================
//  ACCESO (login) — todo lo que está debajo exige sesión
// =====================================================
const intentos = new Map(); // ip -> {n, hasta}
app.get('/login', (req, res) => (leerSesion(req) ? res.redirect('/') : res.render('login', { error: req.query.error || null })));

app.post('/login', w(async (req, res) => {
  const ip = req.ip, reg = intentos.get(ip);
  if (reg && reg.n >= 5 && reg.hasta > Date.now()) return go(res, '/login', 'error', 'Demasiados intentos. Espera 10 minutos.');
  const u = await (await getDb()).collection('usuarios').findOne({ email: (req.body.email || '').trim().toLowerCase() });
  if (!u || !verificarPass(req.body.password || '', u.password_hash)) {
    intentos.set(ip, { n: (reg && reg.hasta > Date.now() ? reg.n : 0) + 1, hasta: Date.now() + 600000 });
    return go(res, '/login', 'error', 'Correo o contraseña incorrectos.');
  }
  intentos.delete(ip);
  iniciarSesion(res, u);
  res.redirect('/');
}));

app.post('/logout', (req, res) => { res.clearCookie('sesion'); res.redirect('/login'); });

app.use(requerirLogin);
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path.endsWith('/eliminar') && res.locals.usuario.rol !== 'admin')
    return res.redirect('/?error=' + encodeURIComponent('Solo el administrador puede eliminar registros.'));
  next();
});
app.use((req, res, next) => {
  if (req.method === 'POST') res.on('finish', () => {
    const loc = String(res.getHeader('Location') || '');
    if (res.statusCode !== 302 || loc.includes('error=')) return;
    const et = ETIQUETAS.find(([re]) => re.test(req.path));
    if (!et) return;
    getDb().then(db => db.collection('actividad').insertOne({
      usuario: res.locals.usuario.nombre, rol: res.locals.usuario.rol, accion: et[1], ruta: req.path, fecha: new Date()
    })).catch(() => {});
  });
  next();
});

// =====================================================
//  INICIO (panel con indicadores)
// =====================================================
app.get('/', w(async (req, res) => {
  const db = await getDb();
  const [libros, socios, activos, vencidos, multas, recientes, porMes, porVencer, disponibles, devueltos] = await Promise.all([
    db.collection('libros').countDocuments(),
    db.collection('socios').countDocuments(),
    db.collection('prestamos').countDocuments({ estado: 'activo' }),
    db.collection('prestamos').countDocuments({ estado: 'activo', fecha_limite: { $lt: new Date() } }),
    db.collection('prestamos').aggregate([{ $group: { _id: null, total: { $sum: '$multa' } } }]).toArray(),
    db.collection('prestamos').aggregate([
      { $sort: { fecha_prestamo: -1 } }, { $limit: 6 },
      { $lookup: { from: 'socios', localField: 'socio_id', foreignField: '_id', as: 'socio' } },
      { $lookup: { from: 'libros', localField: 'libro_id', foreignField: '_id', as: 'libro' } },
      { $unwind: '$socio' }, { $unwind: '$libro' }
    ]).toArray(),
    db.collection('prestamos').aggregate(pipelines.porMes).toArray(),
    db.collection('prestamos').aggregate([
      { $match: { estado: 'activo', fecha_limite: { $gte: new Date(), $lt: new Date(Date.now() + 3 * DIA) } } },
      { $sort: { fecha_limite: 1 } }, { $limit: 6 }, ...LOOKUPS
    ]).toArray(),
    db.collection('libros').aggregate([{ $group: { _id: null, total: { $sum: { $ifNull: ['$copias_disponibles', 0] } } } }]).toArray(),
    db.collection('prestamos').countDocuments({ estado: 'devuelto' })
  ]);
  res.render('inicio', { libros, socios, activos, vencidos, multas: multas[0] ? multas[0].total : 0, recientes, porMes, porVencer, disponibles: disponibles[0]?.total || 0, devueltos });
}));

// =====================================================
//  LIBROS  (CRUD + $push / $pull sobre el array etiquetas)
// =====================================================
function leerLibro(b) {
  const errores = [];
  const datos = {
    titulo: (b.titulo || '').trim(),
    isbn: (b.isbn || '').trim(),
    autores: lista(b.autores),
    categoria: b.categoria,
    etiquetas: lista(b.etiquetas),
    editorial: { nombre: (b.editorial_nombre || '').trim(), pais: (b.editorial_pais || '').trim() },
    anio: parseInt(b.anio, 10),
    copias_total: parseInt(b.copias_total, 10),
    portada: (b.portada || '').trim()
  };
  if (!datos.titulo) errores.push('El título es obligatorio.');
  if (!/^[0-9-]{10,17}$/.test(datos.isbn)) errores.push('ISBN inválido (10 a 17 dígitos o guiones).');
  if (!datos.autores.length) errores.push('Indica al menos un autor (separados por coma).');
  if (!CATEGORIAS.includes(datos.categoria)) errores.push('Categoría inválida.');
  if (!datos.editorial.nombre) errores.push('La editorial es obligatoria.');
  if (!(datos.anio >= 1000 && datos.anio <= new Date().getFullYear())) errores.push('Año inválido.');
  if (!(datos.copias_total >= 1)) errores.push('Las copias deben ser al menos 1.');
  if (datos.portada && !/^https?:\/\/\S+$/i.test(datos.portada)) errores.push('La portada debe ser una URL que empiece por http:// o https://');
  return { datos, errores };
}
const formLibro = (res, libro, errores, action, titulo, status = 200) =>
  res.status(status).render('libros/form', { libro, errores, action, titulo, categorias: CATEGORIAS });

const filtroLibros = qy => {
  const f = {};
  if (qy.q) { const r = new RegExp(esc(qy.q), 'i'); f.$or = [{ titulo: r }, { autores: r }]; }
  if (qy.categoria) f.categoria = qy.categoria;
  return f;
};
const ORDEN = { titulo: 'titulo', categoria: 'categoria', anio: 'anio', copias: 'copias_disponibles' };

app.get('/libros', w(async (req, res) => {
  const col = (await getDb()).collection('libros');
  const f = filtroLibros(req.query);
  const orden = ORDEN[req.query.orden] ? req.query.orden : 'titulo';
  const dir = req.query.dir === 'desc' ? 'desc' : 'asc';
  const pg = pager(req, await col.countDocuments(f));
  const libros = await col.find(f).sort({ [ORDEN[orden]]: dir === 'desc' ? -1 : 1, _id: 1 }).skip((pg.p - 1) * POR_PAG).limit(POR_PAG).toArray();
  res.render('libros/index', { libros, q: req.query.q || '', categoria: req.query.categoria || '', categorias: CATEGORIAS, pg, orden, dir });
}));

app.get('/libros/exportar.csv', w(async (req, res) => {
  const libros = await (await getDb()).collection('libros').find(filtroLibros(req.query)).sort({ titulo: 1 }).toArray();
  csv(res, 'libros.csv', [['Título', 'Autores', 'Categoría', 'Editorial', 'Año', 'Copias disponibles', 'Copias totales'],
    ...libros.map(l => [l.titulo, l.autores.join(', '), l.categoria, l.editorial.nombre, l.anio, l.copias_disponibles, l.copias_total])]);
}));

app.get('/libros/nuevo', (req, res) => formLibro(res, {}, [], '/libros', 'Nuevo libro'));

app.post('/libros', w(async (req, res) => {
  const db = await getDb();
  const { datos, errores } = leerLibro(req.body);
  if (!errores.length) {
    try {
      datos.copias_disponibles = datos.copias_total;
      await db.collection('libros').insertOne(datos);
      return go(res, '/libros', 'ok', 'Libro creado');
    } catch (e) { errores.push(errMsg(e)); }
  }
  formLibro(res, datos, errores, '/libros', 'Nuevo libro', 400);
}));

app.get('/libros/:id', w(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return go(res, '/libros', 'error', 'ID inválido');
  const db = await getDb();
  const libro = await db.collection('libros').findOne({ _id: id });
  if (!libro) return go(res, '/libros', 'error', 'Libro no encontrado');
  const prestamos = await db.collection('prestamos').aggregate([
    { $match: { libro_id: id } },
    { $sort: { fecha_prestamo: -1 } },
    { $limit: 10 },
    { $lookup: { from: 'socios', localField: 'socio_id', foreignField: '_id', as: 'socio' } },
    { $unwind: '$socio' }
  ]).toArray();
  res.render('libros/detalle', { libro, prestamos });
}));

app.get('/api/libros/:id/documento', w(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const libro = await (await getDb()).collection('libros').findOne({ _id: id });
  if (!libro) return res.status(404).json({ error: 'Libro no encontrado' });
  res.set('Cache-Control', 'no-store');
  res.json(libro);
}));

app.get('/libros/:id/editar', w(async (req, res) => {
  const id = oid(req.params.id);
  const libro = id && await (await getDb()).collection('libros').findOne({ _id: id });
  if (!libro) return go(res, '/libros', 'error', 'Libro no encontrado');
  formLibro(res, libro, [], `/libros/${id}`, 'Editar libro');
}));

app.post('/libros/:id', w(async (req, res) => {
  const id = oid(req.params.id);
  const col = (await getDb()).collection('libros');
  const actual = id && await col.findOne({ _id: id });
  if (!actual) return go(res, '/libros', 'error', 'Libro no encontrado');
  const { datos, errores } = leerLibro(req.body);
  const delta = datos.copias_total - actual.copias_total;
  if (actual.copias_disponibles + delta < 0) errores.push('No puedes bajar las copias por debajo de las que están prestadas.');
  if (!errores.length) {
    try {
      await col.updateOne({ _id: id }, { $set: datos, $inc: { copias_disponibles: delta } });
      return go(res, `/libros/${id}`, 'ok', 'Libro actualizado');
    } catch (e) { errores.push(errMsg(e)); }
  }
  formLibro(res, { ...datos, _id: id }, errores, `/libros/${id}`, 'Editar libro', 400);
}));

app.post('/libros/:id/etiquetas', w(async (req, res) => {
  const id = oid(req.params.id);
  const et = (req.body.etiqueta || '').trim();
  if (!id || !et) return go(res, '/libros', 'error', 'Datos inválidos');
  await (await getDb()).collection('libros').updateOne({ _id: id }, { $push: { etiquetas: et } });
  go(res, `/libros/${id}`, 'ok', 'Etiqueta agregada ($push)');
}));

app.post('/libros/:id/etiquetas/quitar', w(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return go(res, '/libros', 'error', 'ID inválido');
  await (await getDb()).collection('libros').updateOne({ _id: id }, { $pull: { etiquetas: req.body.etiqueta } });
  go(res, `/libros/${id}`, 'ok', 'Etiqueta quitada ($pull)');
}));

app.post('/libros/:id/eliminar', w(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return go(res, '/libros', 'error', 'ID inválido');
  const db = await getDb();
  const n = await db.collection('prestamos').countDocuments({ libro_id: id });
  if (n) return go(res, '/libros', 'error', `No se puede eliminar: el libro tiene ${n} préstamos asociados.`);
  await db.collection('libros').deleteOne({ _id: id });
  go(res, '/libros', 'ok', 'Libro eliminado');
}));

// =====================================================
//  SOCIOS
// =====================================================
function leerSocio(b) {
  const errores = [];
  const datos = {
    nombre: (b.nombre || '').trim(),
    documento: (b.documento || '').trim(),
    email: (b.email || '').trim().toLowerCase(),
    tipo: b.tipo,
    direccion: { calle: (b.calle || '').trim(), ciudad: b.ciudad }
  };
  if (!datos.nombre) errores.push('El nombre es obligatorio.');
  if (!/^\d{6,12}$/.test(datos.documento)) errores.push('Documento inválido (6 a 12 dígitos).');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.email)) errores.push('Correo inválido.');
  if (!TIPOS_SOCIO.includes(datos.tipo)) errores.push('Tipo de socio inválido.');
  if (!CIUDADES.includes(datos.direccion.ciudad)) errores.push('Ciudad inválida.');
  return { datos, errores };
}
const formSocio = (res, socio, errores, action, titulo, status = 200) =>
  res.status(status).render('socios/form', { socio, errores, action, titulo, tipos: TIPOS_SOCIO, ciudades: CIUDADES });

app.get('/socios', w(async (req, res) => {
  const col = (await getDb()).collection('socios');
  const f = {};
  if (req.query.q) { const r = new RegExp(esc(req.query.q), 'i'); f.$or = [{ nombre: r }, { documento: r }]; }
  const pg = pager(req, await col.countDocuments(f));
  const socios = await col.find(f).sort({ nombre: 1 }).skip((pg.p - 1) * POR_PAG).limit(POR_PAG).toArray();
  res.render('socios/index', { socios, q: req.query.q || '', pg });
}));

app.get('/socios/nuevo', (req, res) => formSocio(res, {}, [], '/socios', 'Nuevo socio'));

app.post('/socios', w(async (req, res) => {
  const db = await getDb();
  const { datos, errores } = leerSocio(req.body);
  if (!errores.length) {
    try {
      datos.fecha_registro = new Date();
      await db.collection('socios').insertOne(datos);
      return go(res, '/socios', 'ok', 'Socio creado');
    } catch (e) { errores.push(errMsg(e)); }
  }
  formSocio(res, datos, errores, '/socios', 'Nuevo socio', 400);
}));

app.get('/socios/:id/editar', w(async (req, res) => {
  const id = oid(req.params.id);
  const socio = id && await (await getDb()).collection('socios').findOne({ _id: id });
  if (!socio) return go(res, '/socios', 'error', 'Socio no encontrado');
  formSocio(res, socio, [], `/socios/${id}`, 'Editar socio');
}));

app.post('/socios/:id', w(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return go(res, '/socios', 'error', 'ID inválido');
  const { datos, errores } = leerSocio(req.body);
  if (!errores.length) {
    try {
      await (await getDb()).collection('socios').updateOne({ _id: id }, { $set: datos });
      return go(res, '/socios', 'ok', 'Socio actualizado');
    } catch (e) { errores.push(errMsg(e)); }
  }
  formSocio(res, { ...datos, _id: id }, errores, `/socios/${id}`, 'Editar socio', 400);
}));

app.post('/socios/:id/eliminar', w(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return go(res, '/socios', 'error', 'ID inválido');
  const db = await getDb();
  const n = await db.collection('prestamos').countDocuments({ socio_id: id });
  if (n) return go(res, '/socios', 'error', `No se puede eliminar: el socio tiene ${n} préstamos en su historial.`);
  await db.collection('socios').deleteOne({ _id: id });
  go(res, '/socios', 'ok', 'Socio eliminado');
}));

// =====================================================
//  PRÉSTAMOS
// =====================================================
async function formPrestamo(res, errores, status = 200) {
  res.status(status).render('prestamos/form', { errores });
}

app.get('/prestamos', w(async (req, res) => {
  const col = (await getDb()).collection('prestamos');
  const e = req.query.estado || '';
  const m = e === 'vencido' ? { estado: 'activo', fecha_limite: { $lt: new Date() } } : e ? { estado: e } : {};
  const pg = pager(req, await col.countDocuments(m));
  const prestamos = await col.aggregate([
    { $match: m }, { $sort: { fecha_prestamo: -1 } }, { $skip: (pg.p - 1) * POR_PAG }, { $limit: POR_PAG }, ...LOOKUPS
  ]).toArray();
  res.render('prestamos/index', { prestamos, estado: e, maxRenov: MAX_RENOVACIONES, pg });
}));

app.get('/prestamos/exportar.csv', w(async (req, res) => {
  const ps = await (await getDb()).collection('prestamos').aggregate([{ $sort: { fecha_prestamo: -1 } }, ...LOOKUPS]).toArray();
  csv(res, 'prestamos.csv', [['Libro', 'Socio', 'Fecha préstamo', 'Fecha límite', 'Estado', 'Multa'],
    ...ps.map(p => [p.libro.titulo, p.socio.nombre, fecha(p.fecha_prestamo), fecha(p.fecha_limite), p.estado, p.multa || 0])]);
}));

app.get('/prestamos/nuevo', w(async (req, res) => formPrestamo(res, [])));

app.post('/prestamos', w(async (req, res) => {
  const db = await getDb();
  const socio_id = oid(req.body.socio_id);
  const libro_id = oid(req.body.libro_id);
  const dias = Math.min(30, Math.max(1, parseInt(req.body.dias, 10) || 15));
  if (!socio_id || !libro_id) return formPrestamo(res, ['Selecciona un socio y un libro.'], 400);

  const socio = await db.collection('socios').findOne({ _id: socio_id });
  if (!socio) return formPrestamo(res, ['El socio no existe.'], 400);
  const activos = await db.collection('prestamos').countDocuments({ socio_id, estado: 'activo' });
  if (activos >= MAX_ACTIVOS) return formPrestamo(res, [`El socio ya tiene ${MAX_ACTIVOS} préstamos activos.`], 400);

  // Descuento atómico de una copia: solo si todavía hay disponibles
  const libro = await db.collection('libros').findOneAndUpdate(
    { _id: libro_id, copias_disponibles: { $gt: 0 } },
    { $inc: { copias_disponibles: -1 } }
  );
  if (!libro) return formPrestamo(res, ['No hay copias disponibles de ese libro.'], 400);

  const ahora = new Date();
  try {
    await db.collection('prestamos').insertOne({
      socio_id, libro_id, fecha_prestamo: ahora,
      fecha_limite: new Date(ahora.getTime() + dias * DIA),
      estado: 'activo', renovaciones: [], multa: 0
    });
  } catch (e) {
    await db.collection('libros').updateOne({ _id: libro_id }, { $inc: { copias_disponibles: 1 } }); // rollback
    return formPrestamo(res, [errMsg(e)], 400);
  }
  go(res, '/prestamos', 'ok', 'Préstamo registrado');
}));

app.post('/prestamos/:id/devolver', w(async (req, res) => {
  const id = oid(req.params.id);
  const db = await getDb();
  const p = id && await db.collection('prestamos').findOne({ _id: id, estado: 'activo' });
  if (!p) return go(res, '/prestamos', 'error', 'Préstamo activo no encontrado');
  const ahora = new Date();
  const tarde = Math.max(0, Math.ceil((ahora - p.fecha_limite) / DIA));
  const multa = tarde * MULTA_DIA;
  await db.collection('prestamos').updateOne({ _id: id }, { $set: { estado: 'devuelto', fecha_devolucion: ahora, multa } });
  await db.collection('libros').updateOne({ _id: p.libro_id }, { $inc: { copias_disponibles: 1 } });
  go(res, '/prestamos', 'ok', multa ? `Devuelto con multa de $${multa}` : 'Libro devuelto');
}));

app.post('/prestamos/:id/renovar', w(async (req, res) => {
  const id = oid(req.params.id);
  const col = (await getDb()).collection('prestamos');
  const p = id && await col.findOne({ _id: id, estado: 'activo' });
  if (!p) return go(res, '/prestamos', 'error', 'Préstamo activo no encontrado');
  if ((p.renovaciones || []).length >= MAX_RENOVACIONES) return go(res, '/prestamos', 'error', 'Ya alcanzó el máximo de renovaciones.');
  await col.updateOne({ _id: id }, {
    $push: { renovaciones: new Date() },
    $set: { fecha_limite: new Date(p.fecha_limite.getTime() + 7 * DIA) },
    $unset: { aviso_enviado: '' }
  });
  go(res, '/prestamos', 'ok', 'Préstamo renovado 7 días');
}));

app.post('/prestamos/:id/eliminar', w(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return go(res, '/prestamos', 'error', 'ID inválido');
  const r = await (await getDb()).collection('prestamos').deleteOne({ _id: id, estado: 'devuelto' });
  if (!r.deletedCount) return go(res, '/prestamos', 'error', 'Solo se pueden eliminar préstamos ya devueltos.');
  go(res, '/prestamos', 'ok', 'Préstamo eliminado');
}));

// =====================================================
//  REPORTES (aggregate)
// =====================================================
const rangoReporte = q => {
  const anio = /^\d{4}$/.test(q.anio || '') ? Number(q.anio) : null;
  const desde = q.desde && !Number.isNaN(Date.parse(q.desde)) ? new Date(q.desde + 'T00:00:00') : null;
  const hasta = q.hasta && !Number.isNaN(Date.parse(q.hasta)) ? new Date(q.hasta + 'T23:59:59.999') : null;
  const f = {};
  if (desde || hasta) f.fecha_prestamo = { ...(desde ? { $gte: desde } : {}), ...(hasta ? { $lte: hasta } : {}) };
  else if (anio) f.fecha_prestamo = { $gte: new Date(anio, 0, 1), $lt: new Date(anio + 1, 0, 1) };
  return f;
};
const datosReportes = async (col, filtro) => {
  const match = Object.keys(filtro).length ? [{ $match: filtro }] : [];
  const [porCategoria, topLibros, multasPorCiudad, porMes] = await Promise.all([
    col.aggregate([...match, ...pipelines.porCategoria.slice(1)]).toArray(),
    col.aggregate([...match, ...pipelines.topLibros]).toArray(),
    col.aggregate([...match, ...pipelines.multasPorCiudad]).toArray(),
    col.aggregate([...match, ...pipelines.porMes.slice(1)]).toArray()
  ]);
  return { porCategoria, topLibros, multasPorCiudad, porMes };
};
app.get('/reportes', w(async (req, res) => {
  const filtros = { anio: req.query.anio || '', desde: req.query.desde || '', hasta: req.query.hasta || '' };
  const datos = await datosReportes((await getDb()).collection('prestamos'), rangoReporte(filtros));
  res.render('reportes', { ...datos, filtros, imprimir: false });
}));
app.get('/reportes/pdf', w(async (req, res) => {
  const filtros = { anio: req.query.anio || '', desde: req.query.desde || '', hasta: req.query.hasta || '' };
  const datos = await datosReportes((await getDb()).collection('prestamos'), rangoReporte(filtros));
  res.render('reportes', { ...datos, filtros, imprimir: true });
}));
app.get('/reportes/exportar.csv', w(async (req, res) => {
  const filtros = { anio: req.query.anio || '', desde: req.query.desde || '', hasta: req.query.hasta || '' };
  const d = await datosReportes((await getDb()).collection('prestamos'), rangoReporte(filtros));
  csv(res, 'reporte_biblioteca.csv', [
    ['REPORTE DE BIBLIOTECA'], ['Categoría', 'Préstamos', 'Libros distintos'],
    ...d.porCategoria.map(x => [x.categoria, x.total_prestamos, x.libros_distintos]), [],
    ['Top libros', 'Categoría', 'Veces prestado'], ...d.topLibros.map(x => [x.titulo, x.categoria, x.veces]), [],
    ['Ciudad', 'Préstamos devueltos', 'Multa promedio', 'Multa total'], ...d.multasPorCiudad.map(x => [x.ciudad, x.prestamos, x.multa_promedio, x.multa_total]), [],
    ['Mes', 'Préstamos'], ...d.porMes.map(x => [x.mes, x.prestamos])
  ]);
}));

// =====================================================
//  BÚSQUEDA GLOBAL, PERFIL DE SOCIO, ADMINISTRACIÓN
// =====================================================
app.get('/buscar', w(async (req, res) => {
  const q = (req.query.q || '').trim();
  let libros = [], socios = [];
  if (q) {
    const db = await getDb(), r = new RegExp(esc(q), 'i');
    [libros, socios] = await Promise.all([
      db.collection('libros').find({ $or: [{ titulo: r }, { autores: r }, { isbn: r }] }).limit(10).toArray(),
      db.collection('socios').find({ $or: [{ nombre: r }, { documento: r }, { email: r }] }).limit(10).toArray()
    ]);
  }
  res.render('buscar', { q, libros, socios });
}));

app.get('/socios/:id', w(async (req, res) => {
  const id = oid(req.params.id);
  const db = await getDb();
  const socio = id && await db.collection('socios').findOne({ _id: id });
  if (!socio) return go(res, '/socios', 'error', 'Socio no encontrado');
  const col = db.collection('prestamos');
  const [historial, [r]] = await Promise.all([
    col.aggregate([{ $match: { socio_id: id } }, { $sort: { fecha_prestamo: -1 } }, { $limit: 50 }, ...LOOKUPS]).toArray(),
    col.aggregate([{ $match: { socio_id: id } }, { $group: { _id: null, total: { $sum: 1 },
      activos: { $sum: { $cond: [{ $eq: ['$estado', 'activo'] }, 1, 0] } }, multas: { $sum: '$multa' } } }]).toArray()
  ]);
  res.render('socios/perfil', { socio, historial, r: r || { total: 0, activos: 0, multas: 0 } });
}));

const soloAdmin = (req, res, next) =>
  (res.locals.usuario.rol === 'admin' ? next() : go(res, '/', 'error', 'Solo el administrador puede entrar a esa sección.'));

app.get('/admin', soloAdmin, w(async (req, res) => {
  const db = await getDb();
  const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
  const [usuarios, actividad, hoy, avisos, vencidos] = await Promise.all([
    db.collection('usuarios').find({}, { projection: { password_hash: 0 } }).sort({ creado: 1 }).toArray(),
    db.collection('actividad').find().sort({ fecha: -1 }).limit(40).toArray(),
    db.collection('actividad').countDocuments({ fecha: { $gte: hoy0 } }),
    db.collection('prestamos').countDocuments({ aviso_enviado: { $exists: true } }),
    db.collection('prestamos').countDocuments({ estado: 'activo', fecha_limite: { $lt: new Date() } })
  ]);
  res.render('admin', { usuarios, actividad, stats: { hoy, avisos, vencidos } });
}));

app.post('/admin/usuarios', soloAdmin, w(async (req, res) => {
  const b = req.body, email = (b.email || '').trim().toLowerCase(), nombre = (b.nombre || '').trim();
  if (!nombre || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return go(res, '/admin', 'error', 'Nombre o correo inválido.');
  if ((b.password || '').length < 8) return go(res, '/admin', 'error', 'La contraseña debe tener al menos 8 caracteres.');
  if (!['admin', 'bibliotecario'].includes(b.rol)) return go(res, '/admin', 'error', 'Rol inválido.');
  try {
    await (await getDb()).collection('usuarios').insertOne({ nombre, email, password_hash: hashPass(b.password), rol: b.rol, creado: new Date() });
  } catch (e) { return go(res, '/admin', 'error', errMsg(e)); }
  go(res, '/admin', 'ok', 'Usuario creado');
}));

app.post('/admin/avisos', soloAdmin, w(async (req, res) => {
  const r = await enviarAvisos();
  if (r.error) return go(res, '/admin', 'error', r.error);
  go(res, '/admin', r.fallos ? 'error' : 'ok',
    `Avisos: ${r.enviados} enviados, ${r.omitidos} omitidos (correos de prueba), ${r.fallos} con error${r.fallos ? ' (revisa la terminal)' : ''}.`);
}));

// =====================================================
//  API de autocompletado (sugerencias a partir de lo ya registrado)
// =====================================================
app.get('/api/socios', w(async (req, res) => {
  const q = (req.query.q || '').trim();
  const f = req.query.doc ? { documento: String(req.query.doc) }
    : q ? { $or: [{ nombre: new RegExp(esc(q), 'i') }, { documento: new RegExp('^' + esc(q)) }] } : null;
  if (!f) return res.json([]);
  res.json(await (await getDb()).collection('socios').find(f, { projection: { nombre: 1, documento: 1 } }).sort({ nombre: 1 }).limit(8).toArray());
}));

app.get('/api/libros', w(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const r = new RegExp(esc(q), 'i');
  const f = { $or: [{ titulo: r }, { autores: r }, { isbn: r }] };
  if (req.query.disp) f.copias_disponibles = { $gt: 0 };
  res.json(await (await getDb()).collection('libros').find(f, { projection: { titulo: 1, autores: 1, copias_disponibles: 1 } }).sort({ titulo: 1 }).limit(8).toArray());
}));

app.get('/api/editoriales', w(async (req, res) => {
  res.json(await (await getDb()).collection('libros').aggregate([
    { $group: { _id: '$editorial.nombre', pais: { $first: '$editorial.pais' } } },
    { $sort: { _id: 1 } }, { $project: { _id: 0, nombre: '$_id', pais: 1 } }
  ]).toArray());
}));

// ---------- errores ----------
app.use((req, res) => res.status(404).send('Página no encontrada'));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Ocurrió un error interno. Revisa la terminal para más detalles.');
});

const PORT = process.env.PORT || 3000;
(async () => {
  const col = (await getDb()).collection('usuarios');
  await col.createIndex({ email: 1 }, { unique: true });
  const base = [
    { nombre: 'Administrador', email: (process.env.ADMIN_EMAIL || 'admin@biblioteca.com').toLowerCase(), pass: process.env.ADMIN_PASSWORD || 'Admin2026', rol: 'admin' },
    { nombre: 'Bibliotecario', email: 'bibliotecario@biblioteca.com', pass: 'Biblio2026', rol: 'bibliotecario' }
  ];
  for (const u of base) {
    if (!(await col.findOne({ email: u.email })))
      await col.insertOne({ nombre: u.nombre, email: u.email, password_hash: hashPass(u.pass), rol: u.rol, creado: new Date() });
  }
  app.listen(PORT, () => console.log(`Biblioteca en http://localhost:${PORT}`));
  if (correoListo()) {
    const ciclo = () => enviarAvisos().then(r => console.log('Avisos por correo:', r)).catch(e => console.error('Avisos:', e.message));
    ciclo();
    setInterval(ciclo, 6 * 3600e3); // revisa cada 6 horas
  } else console.log('Avisos por correo desactivados (falta SMTP en .env)');
})().catch(e => { console.error(e); process.exit(1); });
