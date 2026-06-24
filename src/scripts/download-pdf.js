require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PDF_BASE_URL = process.env.PDF_BASE_URL || 'https://revistas.inpi.gov.br/pdf';
const DATA_PATH = process.env.PDF_DATA_PATH
  ? path.resolve(process.env.PDF_DATA_PATH)
  : path.join(__dirname, '../../data/pdfs');

function formatNumero(numero) {
  return String(numero).padStart(4, '0');
}

function getPdfUrl(numero) {
  return `${PDF_BASE_URL}/Marcas${formatNumero(numero)}.pdf`;
}

async function baixarPdf(numero) {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true });
  }

  const numStr = formatNumero(numero);
  const pdfPath = path.join(DATA_PATH, `Marcas${numStr}.pdf`);

  if (fs.existsSync(pdfPath)) {
    console.log(`PDF ja existe: ${pdfPath}`);
    return pdfPath;
  }

  const url = getPdfUrl(numero);
  console.log(`Baixando ${url}...`);

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 180000,
    maxRedirects: 5,
    validateStatus: (status) => status < 500,
  });

  if (response.status === 404) {
    throw new Error(`PDF nao encontrado: ${url}`);
  }
  if (response.status !== 200) {
    throw new Error(`Erro HTTP ${response.status} ao baixar ${url}`);
  }

  const writer = fs.createWriteStream(pdfPath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });

  const fd = fs.openSync(pdfPath, 'r');
  const header = Buffer.alloc(4);
  fs.readSync(fd, header, 0, 4, 0);
  fs.closeSync(fd);

  if (header.toString('ascii') !== '%PDF') {
    fs.unlinkSync(pdfPath);
    throw new Error('Arquivo baixado nao parece ser um PDF valido.');
  }

  console.log(`PDF salvo em ${pdfPath}`);
  return pdfPath;
}

async function main() {
  const numero = Number(process.argv[2]);
  if (!numero) {
    throw new Error('Informe o numero da revista. Exemplo: npm run download:pdf -- 2892');
  }

  await baixarPdf(numero);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Erro ao baixar PDF:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { baixarPdf, getPdfUrl };
