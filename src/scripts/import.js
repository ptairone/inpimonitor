require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { importarRevista } = require('./importar');

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
    console.log('Nenhuma revista pendente de importação.');
    await pool.end();
    return;
  }

  console.log(`Revistas para importar: ${pendentes.length}`);

  for (let i = 0; i < pendentes.length; i++) {
    const numero = pendentes[i];
    const numStr = String(numero).padStart(4, '0');
    const xmlPath = path.join(DATA_PATH, `RM${numStr}.xml`);

    process.stdout.write(`[${i + 1}/${pendentes.length}] RM${numStr}... `);

    if (!fs.existsSync(xmlPath)) {
      console.log('arquivo XML não encontrado, pulando');
      continue;
    }

    try {
      const importados = await importarRevista(xmlPath, numero);
      console.log(`${importados} registros importados`);
    } catch (err) {
      console.log(`ERRO: ${err.message}`);
    }
  }

  console.log('\nImportação concluída.');
  await pool.end();
}

main().catch((err) => {
  console.error('Erro fatal na importação:', err.message);
  process.exit(1);
});
