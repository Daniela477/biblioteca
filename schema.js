// Validación de esquema ($jsonSchema) e índices — RF-06 y calidad técnica
const { TIPOS_SOCIO } = require('./config');

const validators = {
  libros: {
    bsonType: 'object',
    required: ['titulo', 'isbn', 'autores', 'categoria', 'editorial', 'copias_total', 'copias_disponibles'],
    properties: {
      titulo: { bsonType: 'string', minLength: 1 },
      isbn: { bsonType: 'string' },
      autores: { bsonType: 'array', minItems: 1, items: { bsonType: 'string' } },      // ARRAY
      categoria: { bsonType: 'string' },
      etiquetas: { bsonType: 'array', items: { bsonType: 'string' } },                // ARRAY
      editorial: {                                                                     // EMBEBIDO
        bsonType: 'object',
        required: ['nombre'],
        properties: { nombre: { bsonType: 'string' }, pais: { bsonType: 'string' } }
      },
      anio: { bsonType: 'number', minimum: 1000, maximum: 2100 },
      copias_total: { bsonType: 'number', minimum: 1 },
      copias_disponibles: { bsonType: 'number', minimum: 0 }
    }
  },
  socios: {
    bsonType: 'object',
    required: ['nombre', 'documento', 'email', 'tipo', 'direccion', 'fecha_registro'],
    properties: {
      nombre: { bsonType: 'string', minLength: 1 },
      documento: { bsonType: 'string' },
      email: { bsonType: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
      tipo: { enum: TIPOS_SOCIO },
      direccion: {                                                                     // EMBEBIDO
        bsonType: 'object',
        required: ['ciudad'],
        properties: { calle: { bsonType: 'string' }, ciudad: { bsonType: 'string' } }
      },
      fecha_registro: { bsonType: 'date' }
    }
  },
  prestamos: {
    bsonType: 'object',
    required: ['socio_id', 'libro_id', 'fecha_prestamo', 'fecha_limite', 'estado'],
    properties: {
      socio_id: { bsonType: 'objectId' },                                              // REFERENCIA
      libro_id: { bsonType: 'objectId' },                                              // REFERENCIA
      fecha_prestamo: { bsonType: 'date' },
      fecha_limite: { bsonType: 'date' },
      fecha_devolucion: { bsonType: ['date', 'null'] },
      estado: { enum: ['activo', 'devuelto'] },
      renovaciones: { bsonType: 'array', items: { bsonType: 'date' } },                // ARRAY
      multa: { bsonType: 'number', minimum: 0 }
    }
  }
};

async function prepararColeccion(db, nombre) {
  const existe = (await db.listCollections({ name: nombre }).toArray()).length > 0;
  if (existe) await db.collection(nombre).drop();
  await db.createCollection(nombre, { validator: { $jsonSchema: validators[nombre] }, validationAction: 'error' });
}

async function crearIndices(db) {
  await db.collection('libros').createIndex({ isbn: 1 }, { unique: true });
  await db.collection('libros').createIndex({ categoria: 1 });
  await db.collection('socios').createIndex({ documento: 1 }, { unique: true });
  await db.collection('socios').createIndex({ email: 1 }, { unique: true });
  // Mejoran $lookup / búsquedas / borrado con integridad referencial:
  await db.collection('prestamos').createIndex({ libro_id: 1 });
  await db.collection('prestamos').createIndex({ socio_id: 1, estado: 1 });
  await db.collection('prestamos').createIndex({ fecha_prestamo: 1 });
}

module.exports = { prepararColeccion, crearIndices };
