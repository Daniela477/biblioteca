// Consultas de agregación del módulo de reportes (RF-05)
const lookupLibro = { $lookup: { from: 'libros', localField: 'libro_id', foreignField: '_id', as: 'libro' } };
const lookupSocio = { $lookup: { from: 'socios', localField: 'socio_id', foreignField: '_id', as: 'socio' } };

module.exports = {
  // 1) ¿Cuántos préstamos hubo por categoría en 2026?  ($match, $lookup, $group, $sort)
  porCategoria: [
    { $match: { fecha_prestamo: { $gte: new Date('2026-01-01') } } },
    lookupLibro,
    { $unwind: '$libro' },
    { $group: { _id: '$libro.categoria', total_prestamos: { $sum: 1 }, libros: { $addToSet: '$libro_id' } } },
    { $project: { _id: 0, categoria: '$_id', total_prestamos: 1, libros_distintos: { $size: '$libros' } } },
    { $sort: { total_prestamos: -1 } }
  ],

  // 2) Top 5 libros más prestados  ($group, $sort, $limit, $lookup)
  topLibros: [
    { $group: { _id: '$libro_id', veces: { $sum: 1 } } },
    { $sort: { veces: -1 } },
    { $limit: 5 },
    { $lookup: { from: 'libros', localField: '_id', foreignField: '_id', as: 'libro' } },
    { $unwind: '$libro' },
    { $project: { _id: 0, titulo: '$libro.titulo', categoria: '$libro.categoria', veces: 1 } }
  ],

  // 3) Multa promedio por ciudad del socio  ($match, $lookup, $group con $avg, $sort)
  multasPorCiudad: [
    { $match: { estado: 'devuelto' } },
    lookupSocio,
    { $unwind: '$socio' },
    { $group: { _id: '$socio.direccion.ciudad', prestamos: { $sum: 1 }, multa_promedio: { $avg: '$multa' }, multa_total: { $sum: '$multa' } } },
    { $project: { _id: 0, ciudad: '$_id', prestamos: 1, multa_total: 1, multa_promedio: { $round: ['$multa_promedio', 0] } } },
    { $sort: { multa_total: -1 } }
  ],

  // 4) Evolución mensual de préstamos  ($match por rango, $group con $dateToString, $sort)
  porMes: [
    { $match: { fecha_prestamo: { $gte: new Date('2025-01-01'), $lt: new Date('2026-12-01') } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$fecha_prestamo' } }, prestamos: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, mes: '$_id', prestamos: 1 } }
  ]
};
