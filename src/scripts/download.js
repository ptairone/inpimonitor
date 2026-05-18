require('dotenv').config();
const axios = require('axios');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, '../../data/xmls');

const PRIMEIRA_REVISTA = 1679; // antes disso era PDF, sem dados estruturados
const BASE_URL = 'https://revistas.inpi.gov.br/txt';
const DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNumero(n) {
  return String(n).padStart(4, '0');
}

async function getRevistasJaBaixadas() {
  const result = await pool.query(
    'SELECT numero_revista FROM revistas_controle WHERE baixado = TRUE'
  );
  return new Set(result.rows.map((r) => r.numero_revista));
}

async function detectarUltimaRevista(ultimaConhecida) {
  let ultima = ultimaConhecida;
  // Sonda até 20 revistas à frente para encontrar as mais recentes
  for (let n = ultimaConhecida + 1; n <= ultimaConhecida + 20; n++) {
    const url = `${BASE_URL}/RM${formatNumero(n)}.zip`;
    try {
      const resp = await axios.head(url, {
        timeout: 10000,
        validateStatus: (s) => s < 500,
        maxRedirects: 3,
      });
      if (resp.status === 200) {
        ultima = n;
      } else {
        break;
      }
    } catch {
      break;
    }
    await sleep(300);
  }
  return ultima;
}

async function marcarBaixada(numero, totalRegistros) {
  await pool.query(
    `INSERT INTO revistas_controle (numero_revista, baixado, data_download, total_registros)
     VALUES ($1, TRUE, NOW(), $2)
     ON CONFLICT (numero_revista) DO UPDATE
       SET baixado = TRUE, data_download = NOW(), total_registros = $2`,
    [numero, totalRegistros]
  );
}

async function downloadRevista(numero) {
  const numStr = formatNumero(numero);
  const url = `${BASE_URL}/RM${numStr}.zip`;
  const xmlPath = path.join(DATA_PATH, `RM${numStr}.xml`);
  const txtPath = path.join(DATA_PATH, `RM${numStr}.txt`);

  if (fs.existsSync(xmlPath)) {
    const xml = fs.readFileSync(xmlPath, 'utf8');
    return (xml.match(/<processo /g) || []).length;
  }
  if (fs.existsSync(txtPath)) {
    const txt = fs.readFileSync(txtPath, 'latin1');
    return (txt.match(/^No\./gm) || []).length;
  }

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    validateStatus: (status) => status < 500,
    maxRedirects: 5,
  });

  if (response.status === 404) return null;
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);

  // verifica se o conteúdo é realmente um ZIP (magic bytes PK = 0x50 0x4B)
  const buf = Buffer.from(response.data);
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4B) {
    return null; // redirecionado para página de erro, trata como não encontrada
  }

  const zip = new AdmZip(buf);
  const entries = zip.getEntries();

  const xmlEntry = entries.find((e) => e.name.toLowerCase().endsWith('.xml'));
  if (xmlEntry) {
    const xmlContent = xmlEntry.getData().toString('utf8');
    fs.writeFileSync(xmlPath, xmlContent, 'utf8');
    return (xmlContent.match(/<processo /g) || []).length;
  }

  const txtEntry = entries.find((e) => e.name.toLowerCase().endsWith('.txt'));
  if (txtEntry) {
    const txtContent = txtEntry.getData().toString('latin1');
    fs.writeFileSync(txtPath, txtContent, 'latin1');
    return (txtContent.match(/^No\./gm) || []).length;
  }

  throw new Error('Nenhum XML ou TXT encontrado no ZIP');
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true });
  }

  const jaBaixadas = await getRevistasJaBaixadas();

  const res = await pool.query(
    'SELECT COALESCE(MAX(numero_revista), $1) AS ultima FROM revistas_controle WHERE baixado = TRUE',
    [PRIMEIRA_REVISTA - 1]
  );
  const ultimaConhecida = Number(res.rows[0].ultima);
  process.stdout.write(`Verificando revistas novas a partir da RM${formatNumero(ultimaConhecida + 1)}... `);
  const TOTAL_REVISTAS = await detectarUltimaRevista(ultimaConhecida);
  console.log(`última disponível: RM${formatNumero(TOTAL_REVISTAS)}`);

  const pendentes = [];
  for (let i = PRIMEIRA_REVISTA; i <= TOTAL_REVISTAS; i++) {
    if (!jaBaixadas.has(i)) pendentes.push(i);
  }

  const total = TOTAL_REVISTAS - PRIMEIRA_REVISTA + 1;
  const totalJaBaixadas = jaBaixadas.size;
  console.log(`Faixa: RM${PRIMEIRA_REVISTA} a RM${TOTAL_REVISTAS} (${total} revistas | TXT: 1679-2219, XML: 2220+)`);
  console.log(`Já baixadas: ${totalJaBaixadas} | Pendentes: ${pendentes.length}`);

  if (pendentes.length === 0) {
    console.log('Nenhuma revista pendente. Download concluído.');
    await pool.end();
    return;
  }

  for (let i = 0; i < pendentes.length; i++) {
    const numero = pendentes[i];
    const baixadasAteAgora = totalJaBaixadas + i;
    const percent = ((baixadasAteAgora / TOTAL_REVISTAS) * 100).toFixed(1);

    process.stdout.write(
      `[${baixadasAteAgora + 1}/${TOTAL_REVISTAS}] (${percent}%) RM${formatNumero(numero)}... `
    );

    try {
      const count = await downloadRevista(numero);

      if (count === null) {
        console.log('não encontrada (404), pulando');
        // registra no controle para não tentar novamente
        await pool.query(
          `INSERT INTO revistas_controle (numero_revista, baixado)
           VALUES ($1, FALSE)
           ON CONFLICT DO NOTHING`,
          [numero]
        );
      } else {
        await marcarBaixada(numero, count);
        console.log(`OK (${count} processos)`);
      }
    } catch (err) {
      console.log(`ERRO: ${err.message}`);
    }

    if (i < pendentes.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log('\nDownload concluído.');
  await pool.end();
}

main().catch((err) => {
  console.error('Erro fatal no download:', err.message);
  process.exit(1);
});
