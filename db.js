require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

if (!process.env.MONGODB_URI) {
  console.error('Falta MONGODB_URI en el archivo .env');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function getDb() {
  if (!db) {
    await client.connect();
    db = client.db(process.env.DB_NAME || 'biblioteca');
  }
  return db;
}

module.exports = { getDb, ObjectId, client };
