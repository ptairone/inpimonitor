const express = require('express');
const router = express.Router();
const pool = require('../../config/database');

// GET /stats/por-uf
router.get('/por-uf', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT uf, COUNT(*) AS total
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
      SELECT pais, COUNT(*) AS total
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
      SELECT unnest(classe_nice) AS classe, COUNT(*) AS total
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
      SELECT status, COUNT(*) AS total
      FROM marcas
      WHERE status IS NOT NULL
      GROUP BY status
      ORDER BY total DESC
      LIMIT 50
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
      SELECT tipo_marca, COUNT(*) AS total
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
      SELECT natureza, COUNT(*) AS total
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

// GET /stats/por-ano — marcas depositadas por ano
router.get('/por-ano', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT EXTRACT(YEAR FROM data_deposito)::INT AS ano, COUNT(*) AS total
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
