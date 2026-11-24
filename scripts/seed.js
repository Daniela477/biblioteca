// Carga inicial: 1000 libros + 300 socios + 3000 préstamos = 4300 documentos
const { fakerES: faker } = require('@faker-js/faker');
const { getDb, ObjectId, client } = require('../db');
const { prepararColeccion, crearIndices } = require('../schema');
const { CATEGORIAS, TIPOS_SOCIO, CIUDADES, MULTA_DIA } = require('../config');

const DIA = 86400000;
const N_LIBROS = 1000, N_SOCIOS = 300, N_PRESTAMOS = 3000;
const EDITORIALES = [
  { nombre: 'Planeta', pais: 'España' }, { nombre: 'Penguin Random House', pais: 'EE.UU.' },
  { nombre: 'Alfaguara', pais: 'España' }, { nombre: 'Norma', pais: 'Colombia' },
  { nombre: 'Siruela', pais: 'España' }, { nombre: 'Fondo de Cultura Económica', pais: 'México' },
  { nombre: 'Panamericana', pais: 'Colombia' }, { nombre: 'Anagrama', pais: 'España' }
];
const ETIQUETAS = ['clásico', 'bestseller', 'premiado', 'ilustrado', 'ensayo', 'juvenil', 'edición especial', 'recomendado'];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

(async () => {
  const db = await getDb();
  for (const c of ['libros', 'socios', 'prestamos']) await prepararColeccion(db, c);
  await crearIndices(db);

  const autores = Array.from({ length: 150 }, () => faker.person.fullName());

  const libros = Array.from({ length: N_LIBROS }, (_, i) => {
    const total = faker.number.int({ min: 1, max: 5 });
    return {
      _id: new ObjectId(),
      titulo: cap(faker.lorem.words({ min: 2, max: 4 })),
      isbn: String(9780000000000 + i),
      autores: faker.helpers.arrayElements(autores, { min: 1, max: 3 }),
      categoria: faker.helpers.arrayElement(CATEGORIAS),
      etiquetas: faker.helpers.arrayElements(ETIQUETAS, { min: 1, max: 3 }),
      editorial: faker.helpers.arrayElement(EDITORIALES),
      anio: faker.number.int({ min: 1950, max: 2025 }),
      copias_total: total,
      copias_disponibles: total
    };
  });

  const socios = Array.from({ length: N_SOCIOS }, (_, i) => ({
    _id: new ObjectId(),
    nombre: faker.person.fullName(),
    documento: String(1000000000 + i),
    email: `socio${i + 1}@correo.com`,
    tipo: faker.helpers.arrayElement(TIPOS_SOCIO),
    direccion: { calle: faker.location.streetAddress(), ciudad: faker.helpers.arrayElement(CIUDADES) },
    fecha_registro: faker.date.between({ from: '2024-01-01', to: '2025-06-30' })
  }));

  const prestamos = [];
  const hoy = new Date('2026-11-22');
  for (let i = 0; i < N_PRESTAMOS; i++) {
    const libro = faker.helpers.arrayElement(libros);
    const socio = faker.helpers.arrayElement(socios);
    const fecha_prestamo = faker.date.between({ from: '2025-01-01', to: '2026-11-20' });
    const fecha_limite = new Date(fecha_prestamo.getTime() + 15 * DIA);
    const reciente = hoy - fecha_prestamo < 20 * DIA;
    const quedaCopia = libro.copias_disponibles > 0;
    const p = { socio_id: socio._id, libro_id: libro._id, fecha_prestamo, fecha_limite, renovaciones: [] };

    if (reciente && quedaCopia && Math.random() < 0.7) {
      p.estado = 'activo';
      p.multa = 0;
      libro.copias_disponibles--;
    } else {
      const devol = new Date(fecha_prestamo.getTime() + faker.number.int({ min: 3, max: 28 }) * DIA);
      const tarde = Math.max(0, Math.ceil((devol - fecha_limite) / DIA));
      p.estado = 'devuelto';
      p.fecha_devolucion = devol;
      p.multa = tarde * MULTA_DIA;
    }
    if (Math.random() < 0.15) p.renovaciones.push(new Date(fecha_prestamo.getTime() + 10 * DIA));
    prestamos.push(p);
  }

  await db.collection('libros').insertMany(libros);
  await db.collection('socios').insertMany(socios);
  await db.collection('prestamos').insertMany(prestamos);

  console.log(`Listo: ${libros.length} libros, ${socios.length} socios, ${prestamos.length} préstamos (${libros.length + socios.length + prestamos.length} documentos)`);
  await client.close();
})().catch(e => { console.error(e); process.exit(1); });
