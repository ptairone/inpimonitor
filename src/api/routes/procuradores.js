const express = require('express');
const router = express.Router();
const pool = require('../../config/database');

// GET /procuradores/top?limit=20
router.get('/top', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const uf = req.query.uf;
    const pais = req.query.pais;

    const conditions = ['procurador IS NOT NULL', "procurador != ''"];
    const params = [];

    if (uf)   { params.push(uf);   conditions.push(`uf ILIKE $${params.length}`); }
    if (pais) { params.push(pais); conditions.push(`pais ILIKE $${params.length}`); }

    params.push(limit);
    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const result = await pool.query(
      `SELECT procurador, COUNT(*) AS total
       FROM marcas
       ${whereClause}
       GROUP BY procurador
       ORDER BY total DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /procuradores/top:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /procuradores/buscar?nome=X
router.get('/buscar', async (req, res) => {
  try {
    const { nome, uf, pais } = req.query;
    if (!nome) return res.status(400).json({ error: 'Informe o parâmetro nome' });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [`procurador ILIKE $1`];
    const params = [`%${nome}%`];

    if (uf)   { params.push(uf);   conditions.push(`uf ILIKE $${params.length}`); }
    if (pais) { params.push(pais); conditions.push(`pais ILIKE $${params.length}`); }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM marcas ${whereClause}`, params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await pool.query(
      `SELECT id, numero_processo, nome_marca, titular, pais, uf,
              classe_nice, status, data_deposito, data_concessao, data_vigencia,
              tipo_marca, natureza, procurador, numero_revista
       FROM marcas
       ${whereClause}
       ORDER BY data_concessao DESC NULLS LAST
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
