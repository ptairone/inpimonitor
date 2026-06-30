const express = require('express');
const router = express.Router();
const pool = require('../../config/database');

// GET /status
router.get('/', async (req, res) => {
  try {
    const [baixadas, importadas, totalMarcas, ultimaXml, pdfPendentes] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM revistas_controle WHERE baixado = TRUE'),
      pool.query('SELECT COUNT(*) FROM revistas_controle WHERE importado = TRUE'),
      pool.query('SELECT COUNT(*) FROM marcas'),
      pool.query(`SELECT MAX(numero_revista) AS ultima FROM revistas_controle WHERE fonte = 'xml'`),
      pool.query(`SELECT COUNT(*) FROM revistas_controle WHERE fonte = 'pdf'`),
    ]);

    const ultimaRevXml = ultimaXml.rows[0].ultima;
    res.json({
      revistas_baixadas: parseInt(baixadas.rows[0].count, 10),
      revistas_importadas: parseInt(importadas.rows[0].count, 10),
      total_marcas: parseInt(totalMarcas.rows[0].count, 10),
      ultima_revista: ultimaRevXml,
      ultima_revista_xml: ultimaRevXml,
      revistas_pdf_pendentes: parseInt(pdfPendentes.rows[0].count, 10),
    });
  } catch (err) {
    console.error('Erro em /status:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
