const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { LIST_FIELDS, buildSort, parseInt10 } = require('../helpers');
const { cacheMiddleware } = require('../middleware/cache');

// GET /titulares/top?limit=20&pais=BR&uf=SP
router.get('/top', cacheMiddleware(300), async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt10(req.query.limit, 20)));
    const { pais, uf } = req.query;

    const conditions = ['titular IS NOT NULL'];
    const params = [];

    if (pais) { params.push(pais); conditions.push(`pais ILIKE $${params.length}`); }
    if (uf)   { params.push(uf);   conditions.push(`uf ILIKE $${params.length}`); }

    params.push(limit);
    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const result = await pool.query(
      `SELECT titular, pais, uf,
              COUNT(*) AS total_marcas,
              COUNT(*) FILTER (WHERE data_vigencia > CURRENT_DATE) AS marcas_vigentes,
              MAX(data_concessao) AS ultima_concessao
       FROM marcas
       ${whereClause}
       GROUP BY titular, pais, uf
       ORDER BY total_marcas DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /titulares/top:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /titulares/buscar?nome=X&pais=BR&uf=SP&sort_by=data_concessao&sort_order=desc
router.get('/buscar', async (req, res) => {
  try {
    const { nome, pais, uf, sort_by, sort_order } = req.query;
    if (!nome) return res.status(400).json({ error: 'Informe o parâmetro nome' });

    const page  = Math.max(1, parseInt10(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseInt10(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const conditions = [`titular ILIKE $1`];
    const params = [`%${nome}%`];

    if (pais) { params.push(pais); conditions.push(`pais ILIKE $${params.length}`); }
    if (uf)   { params.push(uf);   conditions.push(`uf ILIKE $${params.length}`); }

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
    console.error('Erro em /titulares/buscar:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /titulares/comparar?a=NATURA&b=BOTICARIO
router.get('/comparar', async (req, res) => {
  const { a, b } = req.query;
  if (!a || !b) {
    return res.status(400).json({ error: 'Informe os parâmetros a e b com os nomes dos titulares' });
  }

  const statsOf = async (nome) => {
    const [resumo, classes, ufs, porAno] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)                                              AS total_marcas,
           COUNT(*) FILTER (WHERE data_vigencia > CURRENT_DATE) AS vigentes,
           COUNT(*) FILTER (WHERE data_concessao IS NOT NULL)   AS concedidas,
           MIN(data_deposito)                                   AS primeiro_deposito,
           MAX(data_deposito)                                   AS ultimo_deposito,
           MAX(data_concessao)                                  AS ultima_concessao
         FROM marcas WHERE titular ILIKE $1`,
        [`%${nome}%`]
      ),
      pool.query(
        `SELECT unnest(classe_nice) AS classe, COUNT(*) AS total
         FROM marcas WHERE titular ILIKE $1 AND classe_nice IS NOT NULL
         GROUP BY classe ORDER BY total DESC LIMIT 5`,
        [`%${nome}%`]
      ),
      pool.query(
        `SELECT uf, COUNT(*) AS total
         FROM marcas WHERE titular ILIKE $1 AND uf IS NOT NULL AND uf != ''
         GROUP BY uf ORDER BY total DESC LIMIT 5`,
        [`%${nome}%`]
      ),
      pool.query(
        `SELECT EXTRACT(YEAR FROM data_deposito)::INT AS ano, COUNT(*) AS depositos
         FROM marcas WHERE titular ILIKE $1 AND data_deposito IS NOT NULL
         GROUP BY ano ORDER BY ano DESC LIMIT 10`,
        [`%${nome}%`]
      ),
    ]);
    return {
      titular: nome,
      ...resumo.rows[0],
      top_classes: classes.rows,
      top_ufs: ufs.rows,
      depositos_por_ano: porAno.rows,
    };
  };

  try {
    const [dadosA, dadosB] = await Promise.all([statsOf(a), statsOf(b)]);
    res.json({ a: dadosA, b: dadosB });
  } catch (err) {
    console.error('Erro em /titulares/comparar:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
