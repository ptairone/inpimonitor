require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const marcasRouter = require('./routes/marcas');
const statusRouter = require('./routes/status');

const app = express();
const PORT = parseInt(process.env.API_PORT) || 3000;

const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, '../../data/xmls');

app.use(cors());
app.use(express.json());

app.use('/marcas', marcasRouter);
app.use('/status', statusRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
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
  } catch (err) {
    console.error('[CRON] Erro:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`API INPI rodando na porta ${PORT}`);
});

module.exports = app;
