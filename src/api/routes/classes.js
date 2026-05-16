const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { LIST_FIELDS, buildSort, parseInt10 } = require('../helpers');
const { cacheMiddleware } = require('../middleware/cache');

// GET /classes — lista todas as classes Nice com contagens detalhadas
router.get('/', cacheMiddleware(600), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        unnest(classe_nice) AS classe,
        COUNT(*) AS total_marcas,
        COUNT(*) FILTER (WHERE data_vigencia > CURRENT_DATE) AS marcas_vigentes,
        COUNT(*) FILTER (WHERE data_concessao IS NOT NULL) AS marcas_concedidas
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
    const page  = Math.max(1, parseInt10(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseInt10(req.query.limit, 20)));
    const offset = (page - 1) * limit;
    const { sort_by, sort_order } = req.query;
    const classe = req.params.numero.trim();

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM marcas WHERE $1 = ANY(classe_nice)`,
      [classe]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const orderBy = buildSort(sort_by, sort_order, 'data_concessao DESC NULLS LAST');

    const dataResult = await pool.query(
      `SELECT ${LIST_FIELDS}
       FROM marcas
       WHERE $1 = ANY(classe_nice)
       ORDER BY ${orderBy}
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
