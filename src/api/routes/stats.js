const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { parseInt10 } = require('../helpers');

// GET /stats/resumo — visão geral do banco
router.get('/resumo', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)                                                        AS total_marcas,
        COUNT(*) FILTER (WHERE data_vigencia > CURRENT_DATE)           AS vigentes,
        COUNT(*) FILTER (WHERE data_vigencia <= CURRENT_DATE)          AS expiradas,
        COUNT(*) FILTER (WHERE data_vigencia IS NULL)                  AS sem_vigencia,
        COUNT(*) FILTER (WHERE data_concessao IS NOT NULL)             AS concedidas,
        COUNT(DISTINCT titular)                                        AS total_titulares,
        COUNT(DISTINCT procurador) FILTER (WHERE procurador IS NOT NULL
          AND procurador != '')                                        AS total_procuradores,
        MIN(numero_revista)                                            AS revista_mais_antiga,
        MAX(numero_revista)                                            AS revista_mais_recente,
        MIN(data_deposito)                                             AS deposito_mais_antigo,
        MAX(data_deposito)                                             AS deposito_mais_recente,
        (SELECT COUNT(*) FROM historico_despachos)                     AS total_historico_despachos
      FROM marcas
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro em /stats/resumo:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /stats/vencendo-por-mes?meses=24 — distribuição de vencimentos futuros
router.get('/vencendo-por-mes', async (req, res) => {
  try {
    const meses = Math.min(120, Math.max(1, parseInt10(req.query.meses, 24)));
    const result = await pool.query(
      `SELECT
         EXTRACT(YEAR FROM data_vigencia)::INT  AS ano,
         EXTRACT(MONTH FROM data_vigencia)::INT AS mes,
         TO_CHAR(data_vigencia, 'YYYY-MM')      AS periodo,
         COUNT(*)                               AS total
       FROM marcas
       WHERE data_vigencia >= CURRENT_DATE
         AND data_vigencia <= CURRENT_DATE + ($1 * INTERVAL '1 month')
       GROUP BY ano, mes, periodo
       ORDER BY ano, mes`,
      [meses]
    );
    res.json({ meses, data: result.rows });
  } catch (err) {
    console.error('Erro em /stats/vencendo-por-mes:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /stats/por-uf
router.get('/por-uf', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        uf,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE data_vigencia > CURRENT_DATE) AS vigentes
      FROM marcas
      WHERE uf IS NOT NULL AND uf != ''
      GROUP BY uf
      ORDER BY total DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /stats/por-uf:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /stats/por-pais
router.get('/por-pais', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        pais,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE data_vigencia > CURRENT_DATE) AS vigentes
      FROM marcas
      WHERE pais IS NOT NULL AND pais != ''
      GROUP BY pais
      ORDER BY total DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /stats/por-pais:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /stats/por-classe
router.get('/por-classe', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        unnest(classe_nice) AS classe,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE data_vigencia > CURRENT_DATE) AS vigentes
      FROM marcas
      WHERE classe_nice IS NOT NULL
      GROUP BY classe
      ORDER BY total DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /stats/por-classe:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /stats/por-status
router.get('/por-status', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        m.despacho_codigo,
        dc.descricao AS despacho_descricao,
        dc.categoria AS despacho_categoria,
        COUNT(*) AS total
      FROM marcas m
      LEFT JOIN despacho_codigos dc ON dc.codigo = m.despacho_codigo
      WHERE m.despacho_codigo IS NOT NULL
      GROUP BY m.despacho_codigo, dc.descricao, dc.categoria
      ORDER BY total DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /stats/por-status:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /stats/por-tipo
router.get('/por-tipo', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        tipo_marca,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE data_vigencia > CURRENT_DATE) AS vigentes
      FROM marcas
      WHERE tipo_marca IS NOT NULL
      GROUP BY tipo_marca
      ORDER BY total DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /stats/por-tipo:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /stats/por-natureza
router.get('/por-natureza', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        natureza,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE data_vigencia > CURRENT_DATE) AS vigentes
      FROM marcas
      WHERE natureza IS NOT NULL
      GROUP BY natureza
      ORDER BY total DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /stats/por-natureza:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /stats/por-ano — marcas depositadas por ano com breakdown
router.get('/por-ano', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        EXTRACT(YEAR FROM data_deposito)::INT AS ano,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE data_concessao IS NOT NULL) AS concedidas,
        COUNT(*) FILTER (WHERE data_vigencia > CURRENT_DATE) AS vigentes
      FROM marcas
      WHERE data_deposito IS NOT NULL
      GROUP BY ano
      ORDER BY ano ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /stats/por-ano:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
