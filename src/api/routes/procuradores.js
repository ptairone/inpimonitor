const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { LIST_FIELDS, buildSort, parseInt10 } = require('../helpers');

// GET /procuradores/top?limit=20&uf=SP
router.get('/top', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt10(req.query.limit, 20)));
    const { uf, pais } = req.query;

    const conditions = ['procurador IS NOT NULL', "procurador != ''"];
    const params = [];

    if (uf)   { params.push(uf);   conditions.push(`uf ILIKE $${params.length}`); }
    if (pais) { params.push(pais); conditions.push(`pais ILIKE $${params.length}`); }

    params.push(limit);
    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const result = await pool.query(
      `SELECT procurador,
              COUNT(*) AS total_marcas,
              COUNT(*) FILTER (WHERE data_vigencia > CURRENT_DATE) AS marcas_vigentes,
              COUNT(DISTINCT titular) AS total_titulares,
              MAX(data_concessao) AS ultima_concessao
       FROM marcas
       ${whereClause}
       GROUP BY procurador
       ORDER BY total_marcas DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /procuradores/top:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /procuradores/buscar?nome=X&uf=SP&sort_by=data_concessao
router.get('/buscar', async (req, res) => {
  try {
    const { nome, uf, pais, sort_by, sort_order } = req.query;
    if (!nome) return res.status(400).json({ error: 'Informe o parâmetro nome' });

    const page  = Math.max(1, parseInt10(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseInt10(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const conditions = [`procurador ILIKE $1`];
    const params = [`%${nome}%`];

    if (uf)   { params.push(uf);   conditions.push(`uf ILIKE $${params.length}`); }
    if (pais) { params.push(pais); conditions.push(`pais ILIKE $${params.length}`); }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const countResult = await pool.query(`SELECT COUNT(*) FROM marcas ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const orderBy = buildSort(sort_by, sort_order, 'data_concessao DESC NULLS LAST');
    params.push(limit, offset);

    const dataResult = await pool.query(
      `SELECT ${LIST_FIELDS}
       FROM marcas
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: dataResult.rows,
      total,
      page,
      limit,
      paginas: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Erro em /procuradores/buscar:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
