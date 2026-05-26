require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    // Garante que a tabela de controle de migrations existe
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    const applied = await client.query('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(applied.rows.map((r) => r.filename));

    const migrationsDir = path.join(__dirname, '../migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let novas = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  Já aplicada: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Executando ${file}...`);

      // Separar statements CONCURRENTLY (não podem rodar dentro de transação)
      const stmts = sql.split(/;(\s*\n)/).map(s => s.trim()).filter(Boolean);
      const concurrent = stmts.filter(s => /CONCURRENTLY/i.test(s));
      const normal = stmts.filter(s => !/CONCURRENTLY/i.test(s));

      await client.query('BEGIN');
      try {
        for (const stmt of normal) await client.query(stmt);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ERRO em ${file}:`, err.message);
        throw err;
      }

      // Rodar CONCURRENTLY fora da transação
      for (const stmt of concurrent) {
        try {
          await client.query(stmt);
        } catch (err) {
          console.error(`  AVISO CONCURRENTLY em ${file}:`, err.message);
        }
      }

      console.log(`  OK`);
      novas++;
    }

    if (novas === 0) {
      console.log('Banco já atualizado — nenhuma migration nova.');
    } else {
      console.log(`${novas} migration(s) aplicada(s) com sucesso.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Erro na migration:', err.message);
  process.exit(1);
});
