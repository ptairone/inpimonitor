const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const {
  LIST_FIELDS, FROM_MARCAS, SITUACAO_CASE,
  buildSort, parseInt10, toCsv,
} = require('../helpers');
const { cacheMiddleware } = require('../middleware/cache');
const { searchLimiter } = require('../middleware/rateLimit');

// GET /procuradores/autocomplete?q=X
router.get('/autocomplete', searchLimiter, cacheMiddleware(60), async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);

    const result = await pool.query(
      `SELECT DISTINCT procurador
       FROM marcas
       WHERE procurador ILIKE $1 AND procurador IS NOT NULL AND procurador != ''
       ORDER BY procurador
       LIMIT 15`,
      [`${q.trim()}%`]
    );
    res.json(result.rows.map((r) => r.procurador));
  } catch (err) {
    console.error('Erro em /procuradores/autocomplete:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /procuradores/top?limit=20&uf=SP
router.get('/top', cacheMiddleware(300), async (req, res) => {
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

// GET /procuradores/stats?nome=X — distribuição por situação canônica e por status raw
router.get('/stats', cacheMiddleware(300), async (req, res) => {
  try {
    const { nome } = req.query;
    if (!nome) return res.status(400).json({ error: 'Informe o parâmetro nome' });

    const param = [`%${nome}%`];

    const [totalRes, situacaoRes, statusRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total, COUNT(DISTINCT titular) AS total_titulares
         FROM marcas WHERE procurador ILIKE $1`,
        param
      ),
      pool.query(
        `SELECT ${SITUACAO_CASE} AS situacao, COUNT(*) AS qtd
         ${FROM_MARCAS}
         WHERE marcas.procurador ILIKE $1
         GROUP BY situacao
         ORDER BY qtd DESC`,
        param
      ),
      pool.query(
        `SELECT marcas.status, marcas.despacho_codigo, marcas.despacho_categoria,
                COUNT(*) AS qtd
         ${FROM_MARCAS}
         WHERE marcas.procurador ILIKE $1
         GROUP BY marcas.status, marcas.despacho_codigo, marcas.despacho_categoria
         ORDER BY qtd DESC`,
        param
      ),
    ]);

    res.json({
      procurador: nome,
      total: parseInt(totalRes.rows[0].total, 10),
      total_titulares: parseInt(totalRes.rows[0].total_titulares, 10),
      por_situacao: situacaoRes.rows,
      por_status: statusRes.rows,
    });
  } catch (err) {
    console.error('Erro em /procuradores/stats:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /procuradores/buscar?nome=X&uf=SP&sort_by=data_concessao
router.get('/buscar', cacheMiddleware(120), async (req, res) => {
  try {
    const { nome, uf, pais, sort_by, sort_order, numero_revista } = req.query;
    if (!nome) return res.status(400).json({ error: 'Informe o parâmetro nome' });

    const page  = Math.max(1, parseInt10(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseInt10(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const params = [`%${nome}%`];
    const conditions = [`marcas.procurador ILIKE $1`];

    if (uf)             { params.push(uf);                          conditions.push(`marcas.uf ILIKE $${params.length}`); }
    if (pais)           { params.push(pais);                        conditions.push(`marcas.pais ILIKE $${params.length}`); }
    if (numero_revista) { params.push(parseInt10(numero_revista, null)); conditions.push(`marcas.numero_revista = $${params.length}`); }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) ${FROM_MARCAS} ${whereClause}`, params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const orderBy = buildSort(sort_by, sort_order, 'marcas.data_concessao DESC NULLS LAST');
    params.push(limit, offset);

    const dataResult = await pool.query(
      `SELECT ${LIST_FIELDS}
       ${FROM_MARCAS}
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // CSV export
    if (req.query.formato === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="procurador.csv"');
      return res.send(toCsv(dataResult.rows));
    }

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
