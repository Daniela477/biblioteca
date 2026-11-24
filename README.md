# Biblioteca con MongoDB

Aplicación web de gestión bibliotecaria desarrollada con Node.js, Express, EJS y MongoDB. Incluye administración de libros, socios y préstamos, reportes de agregación, avisos por correo y control de acceso.

## Requisitos
- Node.js 18 o superior (recomendado LTS).
- npm.
- MongoDB local o MongoDB Atlas.

## Instalación
1. Descarga y descomprime el proyecto.
2. Abre la carpeta del proyecto en Visual Studio Code.
3. Ejecuta `npm install`.
4. Copia `.env.example` como `.env`.
5. Configura `MONGODB_URI`, `DB_NAME` y un `SESSION_SECRET` aleatorio y privado.
6. Opcionalmente configura SMTP para los avisos por correo.
7. Ejecuta `npm start` y abre `http://localhost:3000`.

> **Importante:** no compartas el archivo `.env`, no publiques contraseñas y no ejecutes `npm run seed` sobre una base de datos con información que quieras conservar. El script seed está pensado para preparar datos de demostración; haz una copia de seguridad antes de utilizarlo.

## Variables de entorno
| Variable | Uso |
|---|---|
| `MONGODB_URI` | Cadena de conexión a MongoDB |
| `DB_NAME` | Nombre de la base de datos (por defecto `biblioteca`) |
| `PORT` | Puerto HTTP (por defecto 3000) |
| `SESSION_SECRET` | Secreto privado para firmar sesiones |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Credenciales iniciales de administrador si aún no existe |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Configuración opcional de correo |
| `AVISO_DIAS` | Anticipación de avisos |

## Funcionalidades
- Inicio de sesión y roles de administrador/bibliotecario.
- CRUD de libros y socios.
- Registro, devolución, renovación y consulta de préstamos.
- Validación de disponibilidad y reglas de préstamo.
- Consulta del documento BSON/JSON real de un libro, incluyendo ObjectId, arrays y objetos embebidos; botón para copiarlo.
- Confirmación en formularios de eliminación y restricción de eliminación a administradores.
- Mensajes de estado vacío en listados y reportes.
- Reportes filtrables por año o rango de fechas, con exportación CSV y vista imprimible para guardar como PDF desde el navegador.
- Indicadores del panel: libros, socios, préstamos activos/vencidos, ejemplares disponibles, devoluciones y multas.
- Historial de actividad administrativa y avisos por correo.

## Exportar reportes a PDF
En **Reportes**, aplica los filtros y selecciona **Exportar PDF**. Se abrirá una vista preparada para impresión. En el diálogo del navegador elige **Guardar como PDF**. No requiere instalar una librería adicional.

## Usuarios de prueba
La aplicación crea usuarios iniciales solo si sus correos no existen. Configura el administrador mediante `ADMIN_EMAIL` y `ADMIN_PASSWORD` en `.env` antes del primer inicio. En instalaciones de demostración, los valores predeterminados históricos del proyecto son `admin@biblioteca.com` / `Admin2026` y `bibliotecario@biblioteca.com` / `Biblio2026`. **Cámbialos inmediatamente y no uses estas credenciales en producción.**

## Capturas de pantalla
Agrega aquí capturas propias después de ejecutar la aplicación: `docs/capturas/inicio.png`, `libros-detalle-json.png`, `reportes-filtros.png`, `reporte-pdf.png` y `administracion.png`. Las capturas no se incluyen porque deben corresponder a una ejecución real con los datos y usuarios de tu instalación.

## Estructura principal
- `app.js`: rutas, controladores y arranque del servidor.
- `db.js`: conexión MongoDB.
- `auth.js`: autenticación y sesiones firmadas.
- `pipelines.js`: consultas de agregación.
- `avisos.js`: notificaciones por correo.
- `views/`: plantillas EJS.
- `public/`: estilos y recursos estáticos.
- `scripts/seed.js`: datos de demostración (usar solo en una base preparada para ello).

## Respaldo y conservación de datos
Los registros viven en MongoDB, no en la carpeta del proyecto. Antes de cambios importantes, crea un respaldo desde MongoDB Atlas o `mongodump`. Mantén la misma `MONGODB_URI` y `DB_NAME` para continuar usando la base existente. Este proyecto no migra ni borra colecciones al iniciar.

## Seguridad y limitaciones
- Mantén `.env` fuera del control de versiones.
- Usa `SESSION_SECRET` aleatorio y credenciales únicas.
- En producción sirve la aplicación detrás de HTTPS y configura `NODE_ENV=production`.
- Revisa los roles de los usuarios y limita el acceso administrativo.
- Las exportaciones contienen información de la biblioteca; compártelas solo con personas autorizadas.
- La vista PDF usa la función de impresión del navegador (Guardar como PDF).
