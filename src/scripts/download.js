require('dotenv').config();
const axios = require('axios');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, '../../data/xmls');

const PRIMEIRA_REVISTA_XML = 2220; // antes disso era TXT ou PDF
const TOTAL_REVISTAS = 2887;
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

  // se o arquivo já existe localmente, apenas registra como baixado
  if (fs.existsSync(xmlPath)) {
    const xml = fs.readFileSync(xmlPath, 'utf8');
    const count = (xml.match(/<processo /g) || []).length;
    return count;
  }

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    validateStatus: (status) => status < 500,
    maxRedirects: 5,
  });

  if (response.status === 404) {
    return null;
  }

  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}`);
  }

  // verifica se o conteúdo é realmente um ZIP (magic bytes PK = 0x50 0x4B)
  const buf = Buffer.from(response.data);
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4B) {
    return null; // redirecionado para página de erro, trata como não encontrada
  }

  const zip = new AdmZip(buf);
  const entries = zip.getEntries().filter((e) => e.name.toLowerCase().endsWith('.xml'));

  if (entries.length === 0) {
    throw new Error('Nenhum XML encontrado no ZIP');
  }

  const xmlContent = entries[0].getData().toString('utf8');
  fs.writeFileSync(xmlPath, xmlContent, 'utf8');

  const count = (xmlContent.match(/<processo /g) || []).length;
  return count;
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true });
  }

  const jaBaixadas = await getRevistasJaBaixadas();
  const pendentes = [];

  for (let i = PRIMEIRA_REVISTA_XML; i <= TOTAL_REVISTAS; i++) {
    if (!jaBaixadas.has(i)) pendentes.push(i);
  }

  const totalXml = TOTAL_REVISTAS - PRIMEIRA_REVISTA_XML + 1;
  const totalJaBaixadas = jaBaixadas.size;
  console.log(`Faixa XML: RM${PRIMEIRA_REVISTA_XML} a RM${TOTAL_REVISTAS} (${totalXml} revistas)`);
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
