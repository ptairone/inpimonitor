require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function migrate() {
  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Executando ${file}...`);
      await client.query(sql);
      console.log(`  OK`);
    }
    console.log('Todas as migrations executadas com sucesso.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Erro na migration:', err.message);
  process.exit(1);
});
