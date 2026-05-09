require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { importarRevistaTxt } = require('./importar-txt');

const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, '../../data/xmls');

async function main() {
  const result = await pool.query(
    `SELECT numero_revista FROM revistas_controle
     WHERE baixado = TRUE AND importado = FALSE
     ORDER BY numero_revista ASC`
  );

  const pendentes = result.rows.map((r) => r.numero_revista);

  if (pendentes.length === 0) {
    console.log('Nenhuma revista TXT pendente de importação.');
    await pool.end();
    return;
  }

  console.log(`Revistas TXT para importar: ${pendentes.length}`);

  for (let i = 0; i < pendentes.length; i++) {
    const numero = pendentes[i];
    const numStr = String(numero).padStart(4, '0');
    const txtPath = path.join(DATA_PATH, `RM${numStr}.txt`);

    process.stdout.write(`[${i + 1}/${pendentes.length}] RM${numStr}... `);

    if (!fs.existsSync(txtPath)) {
      console.log('arquivo TXT não encontrado, pulando');
      continue;
    }

    try {
      const importados = await importarRevistaTxt(txtPath, numero);
      console.log(`${importados} registros importados`);
    } catch (err) {
      console.log(`ERRO: ${err.message}`);
    }
  }

  console.log('\nImportação TXT concluída.');
  await pool.end();
}

main().catch((err) => {
  console.error('Erro fatal na importação TXT:', err.message);
  process.exit(1);
});
