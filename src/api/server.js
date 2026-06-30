require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pool = require('../config/database');
const { importarRevista } = require('../scripts/importar');
const { baixarPdf } = require('../scripts/download-pdf');
const { globalLimiter, searchLimiter } = require('./middleware/rateLimit');
const { invalidatePrefix } = require('./middleware/cache');
const apiKeyMiddleware    = require('./middleware/apiKey');
const adminRouter        = require('./routes/admin');
const marcasRouter       = require('./routes/marcas');
const statusRouter       = require('./routes/status');
const statsRouter        = require('./routes/stats');
const classesRouter      = require('./routes/classes');
const titularesRouter    = require('./routes/titulares');
const procuradoresRouter = require('./routes/procuradores');
const webhooksRouter     = require('./routes/webhooks');

const app = express();
const PORT = parseInt(process.env.API_PORT) || 3000;

const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, '../../data/xmls');

// CORS — aceita lista de origens via CORS_ORIGINS (vírgula separado) ou libera tudo
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : null;

app.use(cors(allowedOrigins
  ? {
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`Origem não permitida: ${origin}`));
      },
      credentials: true,
    }
  : {}
));

app.use(express.json());
app.set('trust proxy', 1);
app.use(globalLimiter);
app.use('/admin',        adminRouter);
app.use(apiKeyMiddleware);

app.use('/marcas',       marcasRouter);
app.use('/status',       statusRouter);
app.use('/stats',        statsRouter);
app.use('/classes',      classesRouter);
app.use('/titulares',    titularesRouter);
app.use('/procuradores', procuradoresRouter);
app.use('/webhooks',     webhooksRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Cron: diariamente às 08h envia notificações de vencimento via webhooks
cron.schedule('0 8 * * *', async () => {
  console.log('[WEBHOOK] Verificando vencimentos para notificações...');
  try {
    const hooks = await pool.query(
      `SELECT id, url, min_dias FROM webhooks WHERE ativo = TRUE AND evento = 'vencimento'`
    );
    if (!hooks.rows.length) return;

    for (const hook of hooks.rows) {
      try {
        const result = await pool.query(
          `SELECT numero_processo, nome_marca, titular, data_vigencia, classe_nice, procurador
           FROM marcas
           WHERE data_vigencia = CURRENT_DATE + ($1 * INTERVAL '1 day')
           ORDER BY nome_marca
           LIMIT 500`,
          [hook.min_dias]
        );
        if (!result.rows.length) continue;

        await axios.post(hook.url, {
          evento: 'vencimento',
          min_dias: hook.min_dias,
          total: result.rows.length,
          data: result.rows,
        }, { timeout: 15000 });

        console.log(`[WEBHOOK] ${hook.url} — ${result.rows.length} marcas vencendo em ${hook.min_dias} dias.`);
      } catch (err) {
        console.error(`[WEBHOOK] Falha ao notificar ${hook.url}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[WEBHOOK] Erro geral:', err.message);
  }
});

const PDF_DATA_PATH = process.env.PDF_DATA_PATH
  ? path.resolve(process.env.PDF_DATA_PATH)
  : path.join(__dirname, '../../data/pdfs');

function invalidarCachesDeRevista() {
  invalidatePrefix('/stats');
  invalidatePrefix('/classes');
  invalidatePrefix('/titulares');
  invalidatePrefix('/procuradores');
}

// Baixa e valida o ZIP/XML real do INPI. Retorna o caminho do .xml salvo em disco,
// ou null se a revista ainda não foi publicada nesse formato (o INPI redireciona
// revista inexistente para uma página de erro com HTTP 200, por isso checamos os
// magic bytes do ZIP, não só o status).
async function baixarXmlReal(numero) {
  const numStr = String(numero).padStart(4, '0');
  const url = `https://revistas.inpi.gov.br/txt/RM${numStr}.zip`;

  let response;
  try {
    response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 120000,
      validateStatus: (s) => s < 500,
      maxRedirects: 5,
    });
  } catch {
    return null;
  }
  if (response.status !== 200) return null;

  const buf = Buffer.from(response.data);
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return null; // magic bytes PK

  const zip = new AdmZip(buf);
  const entry = zip.getEntries().find((e) => e.name.toLowerCase().endsWith('.xml'));
  if (!entry) return null;

  if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true });
  const xmlPath = path.join(DATA_PATH, `RM${numStr}.xml`);
  fs.writeFileSync(xmlPath, entry.getData().toString('utf8'), 'utf8');
  return xmlPath;
}

// Revistas que entraram provisoriamente via PDF (extração lossy, ver memória do
// projeto): reverifica se o XML definitivo já saiu e, se sim, descarta os dados
// do PDF e reimporta do XML completo.
async function promoverRevistasPdfParaXml() {
  const { rows } = await pool.query(
    `SELECT numero_revista FROM revistas_controle WHERE fonte = 'pdf' ORDER BY numero_revista`
  );

  for (const { numero_revista: numero } of rows) {
    const xmlPath = await baixarXmlReal(numero);
    if (!xmlPath) continue;

    console.log(`[CRON] RM${numero}: XML saiu, substituindo importação provisória do PDF...`);
    await pool.query('DELETE FROM historico_despachos WHERE numero_revista = $1', [numero]);
    await pool.query('DELETE FROM marcas WHERE numero_revista = $1', [numero]);
    const importados = await importarRevista(xmlPath, numero);
    console.log(`[CRON] RM${numero}: ${importados} registros reimportados do XML.`);
    invalidarCachesDeRevista();
  }
}

// Próxima revista nunca importada: prefere XML; se ainda não saiu, usa o PDF como
// importação provisória (fonte='pdf'), que promoverRevistasPdfParaXml() substitui
// pelo XML completo assim que ele for publicado (algumas horas depois, no mesmo dia).
async function importarProximaEdicao() {
  const result = await pool.query(
    `SELECT COALESCE(MAX(numero_revista), 0) AS ultima FROM revistas_controle WHERE fonte = 'xml'`
  );
  const proxima = parseInt(result.rows[0].ultima, 10) + 1;
  const numStr = String(proxima).padStart(4, '0');

  const xmlPath = await baixarXmlReal(proxima);
  if (xmlPath) {
    const importados = await importarRevista(xmlPath, proxima);
    console.log(`[CRON] RM${numStr} importada via XML: ${importados} registros.`);
    invalidarCachesDeRevista();
    return;
  }

  let pdfPath;
  try {
    pdfPath = await baixarPdf(proxima);
  } catch {
    console.log(`[CRON] RM${numStr}: nem XML nem PDF disponíveis ainda.`);
    return;
  }

  console.log(`[CRON] RM${numStr}: XML ainda não saiu, importando provisoriamente do PDF...`);
  const jsonlPath = path.join(PDF_DATA_PATH, `Marcas${numStr}.jsonl`);
  execFileSync('python3', [
    path.join(__dirname, '../scripts/extrair-pdf.py'),
    pdfPath,
    '--revista', String(proxima),
    '--out', jsonlPath,
  ], { stdio: 'inherit' });
  execFileSync('node', [path.join(__dirname, '../scripts/import-pdf.js'), jsonlPath, String(proxima)], {
    stdio: 'inherit',
  });
  console.log(`[CRON] RM${numStr} importada provisoriamente do PDF.`);
  invalidarCachesDeRevista();
}

// Cron: de hora em hora, promove revistas PDF->XML quando o XML sai e verifica
// se há uma edição nova (XML preferencial, PDF como provisório).
let cronEmExecucao = false;
cron.schedule('0 * * * *', async () => {
  if (cronEmExecucao) {
    console.log('[CRON] Execução anterior ainda em andamento, pulando esta.');
    return;
  }
  cronEmExecucao = true;
  console.log('[CRON] Verificando nova edição do INPI...');
  try {
    await promoverRevistasPdfParaXml();
    await importarProximaEdicao();
  } catch (err) {
    console.error('[CRON] Erro:', err.message);
  } finally {
    cronEmExecucao = false;
  }
});

app.listen(PORT, () => {
  console.log(`API INPI rodando na porta ${PORT}`);
});

module.exports = app;
