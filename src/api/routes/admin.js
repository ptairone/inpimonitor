const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const adminAuth = require('../middleware/adminAuth');

const ROOT = path.join(__dirname, '../../../');

const DATA_XML = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(ROOT, 'data/xmls');

const DATA_PDF = process.env.PDF_DATA_PATH
  ? path.resolve(process.env.PDF_DATA_PATH)
  : path.join(ROOT, 'data/pdfs');

router.use(adminAuth);

router.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'src/views/admin.html'));
});

// Verifica se o ZIP/XML da revista está disponível no INPI (magic bytes PK)
router.get('/check/:revista', async (req, res) => {
  const num = String(req.params.revista).padStart(4, '0');
  const url = `https://revistas.inpi.gov.br/txt/RM${num}.zip`;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      validateStatus: (s) => s < 500,
      maxRedirects: 5,
    });
    if (response.status !== 200) return res.json({ xml: false });
    const buf = Buffer.from(response.data);
    const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
    res.json({ xml: isZip });
  } catch {
    res.json({ xml: false, error: true });
  }
});

function sseStream(res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  return {
    log: (text) => res.write(`data: ${JSON.stringify({ type: 'log', text })}\n\n`),
    done: (ok) => { res.write(`data: ${JSON.stringify({ type: 'done', ok })}\n\n`); res.end(); },
  };
}

function runProcess(cmd, args, sse) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: ROOT });
    proc.stdout.on('data', (d) => sse.log(d.toString()));
    proc.stderr.on('data', (d) => sse.log(d.toString()));
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', (err) => { sse.log(`Erro: ${err.message}\n`); resolve(false); });
  });
}

// Importar via XML (download.js já cuida de tudo)
router.get('/stream/xml/:revista', async (req, res) => {
  const num = req.params.revista;
  const sse = sseStream(res);
  sse.log(`Iniciando importação XML da RM${num}...\n`);
  const ok = await runProcess('node', ['src/scripts/download.js', num], sse);
  sse.done(ok);
});

// Importar via PDF: 3 passos sequenciais
router.get('/stream/pdf/:revista', async (req, res) => {
  const num = String(req.params.revista).padStart(4, '0');
  const numInt = parseInt(num, 10);
  const sse = sseStream(res);

  if (!fs.existsSync(DATA_PDF)) fs.mkdirSync(DATA_PDF, { recursive: true });

  const pdfPath = path.join(DATA_PDF, `Marcas${num}.pdf`);
  const jsonlPath = path.join(DATA_PDF, `Marcas${num}.jsonl`);
  const pdfUrl = `https://revistas.inpi.gov.br/pdf/Marcas${num}.pdf`;

  sse.log(`[1/3] Baixando PDF: ${pdfUrl}\n`);
  const dl = await runProcess('wget', ['-nv', pdfUrl, '-O', pdfPath], sse);
  if (!dl) { sse.log('Falha ao baixar o PDF.\n'); return sse.done(false); }

  sse.log(`\n[2/3] Extraindo registros do PDF...\n`);
  const ext = await runProcess('python3', [
    'src/scripts/extrair-pdf.py', pdfPath,
    '--revista', String(numInt),
    '--out', jsonlPath,
  ], sse);
  if (!ext) { sse.log('Falha ao extrair o PDF.\n'); return sse.done(false); }

  sse.log(`\n[3/3] Importando no banco de dados...\n`);
  const imp = await runProcess('node', ['src/scripts/import-pdf.js', jsonlPath, String(numInt)], sse);
  sse.done(imp);
});

module.exports = router;
