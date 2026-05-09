const express = require('express');
const router = express.Router();
const pool = require('../../config/database');

// GET /classes — lista todas as classes Nice com contagem
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT unnest(classe_nice) AS classe, COUNT(*) AS total
      FROM marcas
      WHERE classe_nice IS NOT NULL
      GROUP BY classe
      ORDER BY classe ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /classes:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /classes/:numero — marcas de uma classe específica
router.get('/:numero', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const classe = req.params.numero.trim();

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM marcas WHERE $1 = ANY(classe_nice)`,
      [classe]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await pool.query(
      `SELECT id, numero_processo, nome_marca, titular, pais, uf,
              classe_nice, status, data_deposito, data_concessao, data_vigencia,
              tipo_marca, natureza, procurador, numero_revista
       FROM marcas
       WHERE $1 = ANY(classe_nice)
       ORDER BY data_concessao DESC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [classe, limit, offset]
    );

    res.json({
      classe,
      data: dataResult.rows,
      total,
      page,
      limit,
      paginas: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Erro em /classes/:numero:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
