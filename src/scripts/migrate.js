require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

// Divide SQL em statements respeitando dollar-quoting ($$, $body$, $func$, etc.)
function splitSql(sql) {
  const stmts = [];
  let cur = '';
  let inDollar = false;
  let tag = '';
  let i = 0;
  while (i < sql.length) {
    if (!inDollar && sql[i] === '$') {
      const m = sql.slice(i).match(/^\$([A-Za-z_]*)\$/);
      if (m) { tag = m[0]; inDollar = true; cur += tag; i += tag.length; continue; }
    }
    if (inDollar && sql.slice(i).startsWith(tag)) {
      cur += tag; i += tag.length; inDollar = false; tag = ''; continue;
    }
    if (!inDollar && sql[i] === ';') {
      const stmt = cur.trim();
      if (stmt) stmts.push(stmt);
      cur = ''; i++; continue;
    }
    cur += sql[i]; i++;
  }
  const last = cur.trim();
  if (last) stmts.push(last);
  return stmts.filter(Boolean);
}

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

      // Separar statements respeitando dollar-quoting ($$...$$, $body$...$body$, etc.)
      const stmts = splitSql(sql);
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
