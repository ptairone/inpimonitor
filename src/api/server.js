require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { globalLimiter, searchLimiter } = require('./middleware/rateLimit');
const { invalidatePrefix } = require('./middleware/cache');
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

app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);
app.use(globalLimiter);

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

// Cron: toda terça-feira às 10h verifica nova edição
cron.schedule('0 10 * * 2', async () => {
  console.log('[CRON] Verificando nova edição do INPI...');
  try {
    const result = await pool.query(
      'SELECT MAX(numero_revista) AS max FROM revistas_controle WHERE baixado = TRUE'
    );
    const ultimaRevista = parseInt(result.rows[0].max, 10) || 0;
    const proxima = ultimaRevista + 1;
    const numStr = String(proxima).padStart(4, '0');
    const url = `https://revistas.inpi.gov.br/txt/RM${numStr}.zip`;

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 120000,
      validateStatus: (s) => s < 500,
    });

    if (response.status === 404) {
      console.log(`[CRON] RM${numStr} ainda não disponível.`);
      return;
    }

    if (response.status !== 200) {
      console.log(`[CRON] RM${numStr} retornou HTTP ${response.status}.`);
      return;
    }

    if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true });

    const zip = new AdmZip(Buffer.from(response.data));
    const entries = zip.getEntries().filter((e) => e.name.toLowerCase().endsWith('.xml'));
    if (entries.length === 0) {
      console.log(`[CRON] RM${numStr}: nenhum XML encontrado no ZIP.`);
      return;
    }

    const xmlContent = entries[0].getData().toString('utf8');
    const xmlPath = path.join(DATA_PATH, `RM${numStr}.xml`);
    fs.writeFileSync(xmlPath, xmlContent, 'utf8');

    const count = (xmlContent.match(/<processo /g) || []).length;

    await pool.query(
      `INSERT INTO revistas_controle (numero_revista, baixado, data_download, total_registros)
       VALUES ($1, TRUE, NOW(), $2)
       ON CONFLICT (numero_revista) DO UPDATE
         SET baixado = TRUE, data_download = NOW(), total_registros = $2`,
      [proxima, count]
    );

    console.log(`[CRON] RM${numStr} baixada (${count} processos). Iniciando importação...`);

    // importa inline usando o mesmo módulo de importação
    const { importarRevista } = require('../scripts/importar');
    const importados = await importarRevista(xmlPath, proxima);
    console.log(`[CRON] RM${numStr} importada: ${importados} registros.`);
    invalidatePrefix('/stats');
    invalidatePrefix('/classes');
    invalidatePrefix('/titulares');
    invalidatePrefix('/procuradores');
  } catch (err) {
    console.error('[CRON] Erro:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`API INPI rodando na porta ${PORT}`);
});

module.exports = app;
