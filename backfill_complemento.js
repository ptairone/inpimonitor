// backfill_complemento.js
// Reimporta revistas RM2734-RM2890 para preencher:
//   - historico_despachos.complemento  (via COALESCE no upsert)
//   - marcas.despacho_complemento      (marcas cujo ultimo status está nesse range)
//   - marcas.sobrestadores             (idem)
// Roda em background: nohup node backfill_complemento.js > /tmp/backfill.log 2>&1 &

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('./src/config/database');
const { importarRevista }    = require('./src/scripts/importar');
const { importarRevistaTxt } = require('./src/scripts/importar-txt');

const PRIMEIRA = 2734;
const ULTIMA   = 2890;
const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, 'data/xmls');

function fmt(n) { return String(n).padStart(4, '0'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log(`[backfill] Iniciando RM${fmt(PRIMEIRA)}–RM${fmt(ULTIMA)} em ${new Date().toISOString()}`);

  const { rows } = await pool.query(
    'SELECT numero_revista FROM revistas_controle WHERE numero_revista >= $1 AND numero_revista <= $2 AND baixado = TRUE ORDER BY numero_revista',
    [PRIMEIRA, ULTIMA]
  );
  console.log(`[backfill] ${rows.length} revistas para reimportar`);

  let ok = 0, erros = 0;

  for (let i = 0; i < rows.length; i++) {
    const num = rows[i].numero_revista;
    const xmlPath = path.join(DATA_PATH, `RM${fmt(num)}.xml`);
    const txtPath = path.join(DATA_PATH, `RM${fmt(num)}.txt`);

    process.stdout.write(`[${i+1}/${rows.length}] RM${fmt(num)}... `);

    let tentativas = 0;
    while (tentativas < 3) {
      try {
        let count;
        if (fs.existsSync(xmlPath))      count = await importarRevista(xmlPath, num);
        else if (fs.existsSync(txtPath)) count = await importarRevistaTxt(txtPath, num);
        else { console.log('arquivo nao encontrado, pulando'); break; }
        console.log(`OK (${count} registros)`);
        ok++;
        break;
      } catch (e) {
        tentativas++;
        if (e.code === '40P01' && tentativas < 3) {
          // deadlock — aguarda e tenta novamente
          console.log(`deadlock, retry ${tentativas}/3...`);
          await sleep(2000 * tentativas);
        } else {
          console.log(`ERRO: ${e.message}`);
          erros++;
          break;
        }
      }
    }

    // Pausa leve para não sobrecarregar o banco durante uso normal da API
    await sleep(200);
  }

  console.log(`\n[backfill] Import concluido: ${ok} OK | ${erros} erros`);

  // Pós-backfill: propaga complemento do historico para marcas.despacho_complemento
  // (cobre marcas cujo numero_revista coincide com alguma revista reimportada)
  console.log('\n[backfill] Propagando complemento para tabela marcas...');
  const res = await pool.query(`
    UPDATE marcas m
    SET despacho_complemento = hd.complemento
    FROM historico_despachos hd
    WHERE hd.numero_processo  = m.numero_processo
      AND hd.numero_revista   = m.numero_revista
      AND hd.despacho_codigo  = m.despacho_codigo
      AND hd.complemento      IS NOT NULL
      AND m.despacho_complemento IS NULL
  `);
  console.log(`[backfill] marcas.despacho_complemento preenchido: ${res.rowCount} registros`);

  console.log(`\n[backfill] Concluido em ${new Date().toISOString()}`);
  await pool.end();
}

main().catch(e => { console.error('[backfill] Erro fatal:', e.message); process.exit(1); });
