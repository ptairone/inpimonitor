require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { importarRevista } = require('./importar');
const { importarRevistaTxt } = require('./importar-txt');

// Importado inline para não depender de outro processo
const axios = require('axios');
const AdmZip = require('adm-zip');

const PRIMEIRA_REVISTA = 1679;
const BASE_URL = 'https://revistas.inpi.gov.br/txt';
const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, '../../data/xmls');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmt(n) { return String(n).padStart(4, '0'); }

async function detectarUltimaRevista(ultimaConhecida) {
  let ultima = ultimaConhecida;
  for (let n = ultimaConhecida + 1; n <= ultimaConhecida + 20; n++) {
    try {
      const resp = await axios.head(`${BASE_URL}/RM${fmt(n)}.zip`, {
        timeout: 10000, validateStatus: s => s < 500, maxRedirects: 3,
      });
      if (resp.status === 200) { ultima = n; } else { break; }
    } catch { break; }
    await sleep(300);
  }
  return ultima;
}

async function baixarRevista(numero) {
  const xmlPath = path.join(DATA_PATH, `RM${fmt(numero)}.xml`);
  const txtPath = path.join(DATA_PATH, `RM${fmt(numero)}.txt`);
  if (fs.existsSync(xmlPath)) return 'xml';
  if (fs.existsSync(txtPath)) return 'txt';

  const response = await axios.get(`${BASE_URL}/RM${fmt(numero)}.zip`, {
    responseType: 'arraybuffer', timeout: 120000, validateStatus: s => s < 500,
  });
  if (response.status === 404) return null;
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);

  const buf = Buffer.from(response.data);
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4B) return null;

  const zip = new AdmZip(buf);
  const entries = zip.getEntries();

  const xmlEntry = entries.find(e => e.name.toLowerCase().endsWith('.xml'));
  if (xmlEntry) {
    fs.writeFileSync(xmlPath, xmlEntry.getData().toString('utf8'), 'utf8');
    return 'xml';
  }
  const txtEntry = entries.find(e => e.name.toLowerCase().endsWith('.txt'));
  if (txtEntry) {
    fs.writeFileSync(txtPath, txtEntry.getData().toString('latin1'), 'latin1');
    return 'txt';
  }
  throw new Error('Nenhum XML ou TXT no ZIP');
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true });

  const inicio = Date.now();
  console.log('=== SYNC INPI ===\n');

  // 1. Detectar última revista disponível
  const res = await pool.query(
    'SELECT COALESCE(MAX(numero_revista), $1) AS ultima FROM revistas_controle WHERE baixado = TRUE',
    [PRIMEIRA_REVISTA - 1]
  );
  const ultimaConhecida = Number(res.rows[0].ultima);
  process.stdout.write(`Verificando revistas novas (última conhecida: RM${fmt(ultimaConhecida)})... `);
  const ultimaDisponivel = await detectarUltimaRevista(ultimaConhecida);
  console.log(`última disponível: RM${fmt(ultimaDisponivel)}\n`);

  // 2. Baixar revistas que faltam
  const { rows: jaBaixadasRows } = await pool.query(
    'SELECT numero_revista FROM revistas_controle WHERE baixado = TRUE'
  );
  const jaBaixadas = new Set(jaBaixadasRows.map(r => r.numero_revista));
  const paraDownload = [];
  for (let i = PRIMEIRA_REVISTA; i <= ultimaDisponivel; i++) {
    if (!jaBaixadas.has(i)) paraDownload.push(i);
  }

  if (paraDownload.length === 0) {
    console.log('Nenhuma revista nova para baixar.');
  } else {
    console.log(`--- DOWNLOAD: ${paraDownload.length} revistas ---`);
    for (let i = 0; i < paraDownload.length; i++) {
      const num = paraDownload[i];
      process.stdout.write(`[${i+1}/${paraDownload.length}] RM${fmt(num)}... `);
      try {
        const tipo = await baixarRevista(num);
        if (!tipo) {
          console.log('não encontrada (404)');
          await pool.query(
            'INSERT INTO revistas_controle (numero_revista, baixado) VALUES ($1, FALSE) ON CONFLICT DO NOTHING',
            [num]
          );
        } else {
          await pool.query(
            `INSERT INTO revistas_controle (numero_revista, baixado, data_download)
             VALUES ($1, TRUE, NOW())
             ON CONFLICT (numero_revista) DO UPDATE SET baixado = TRUE, data_download = NOW()`,
            [num]
          );
          console.log(`OK (${tipo})`);
        }
      } catch (e) {
        console.log(`ERRO: ${e.message}`);
      }
      if (i < paraDownload.length - 1) await sleep(800);
    }
    console.log('');
  }

  // 3. Importar tudo que foi baixado mas não importado
  const { rows: pendentes } = await pool.query(
    'SELECT numero_revista FROM revistas_controle WHERE baixado = TRUE AND importado = FALSE ORDER BY numero_revista'
  );

  if (pendentes.length === 0) {
    console.log('Nenhuma revista pendente de importação. Tudo atualizado!');
  } else {
    console.log(`--- IMPORT: ${pendentes.length} revistas ---`);
    let okImport = 0, errosImport = 0;
    for (let i = 0; i < pendentes.length; i++) {
      const num = pendentes[i].numero_revista;
      const xmlPath = path.join(DATA_PATH, `RM${fmt(num)}.xml`);
      const txtPath = path.join(DATA_PATH, `RM${fmt(num)}.txt`);
      process.stdout.write(`[${i+1}/${pendentes.length}] RM${fmt(num)}... `);
      try {
        let count;
        if (fs.existsSync(xmlPath)) count = await importarRevista(xmlPath, num);
        else if (fs.existsSync(txtPath)) count = await importarRevistaTxt(txtPath, num);
        else { console.log('arquivo não encontrado'); continue; }
        console.log(`OK (${count} registros)`);
        okImport++;
      } catch (e) {
        console.log(`ERRO: ${e.message}`);
        errosImport++;
      }
    }
    console.log(`\nImport: ${okImport} OK | ${errosImport} erros`);
  }

  const mins = ((Date.now() - inicio) / 60000).toFixed(1);
  console.log(`\n=== Sync concluído em ${mins} min ===`);
  await pool.end();
}

main().catch(e => { console.error('Erro fatal:', e.message); process.exit(1); });
