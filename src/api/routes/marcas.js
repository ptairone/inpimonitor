const express = require('express');
const router = express.Router();
const pool = require('../../config/database');

function parseInt10(val, def) {
  const n = parseInt(val, 10);
  return isNaN(n) ? def : n;
}

// GET /marcas/buscar
router.get('/buscar', async (req, res) => {
  try {
    const { nome, titular, cnpj, processo, classe, status } = req.query;
    const page = Math.max(1, parseInt10(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseInt10(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (nome) {
      params.push(nome);
      // websearch_to_tsquery aceita texto livre sem precisar formatar operadores
      conditions.push(`search_vector @@ websearch_to_tsquery('portuguese', $${params.length})`);
    }

    if (titular) {
      params.push(`%${titular}%`);
      conditions.push(`titular ILIKE $${params.length}`);
    }

    // cnpj não existe no XML do INPI mas mantemos o endpoint para compatibilidade
    if (cnpj) {
      return res.json({ data: [], total: 0, page, limit, paginas: 0 });
    }

    if (processo) {
      params.push(processo.trim());
      conditions.push(`numero_processo = $${params.length}`);
    }

    if (classe) {
      params.push(classe.trim());
      conditions.push(`$${params.length} = ANY(classe_nice)`);
    }

    if (status) {
      params.push(`%${status}%`);
      conditions.push(`status ILIKE $${params.length}`);
    }

    if (conditions.length === 0) {
      return res.status(400).json({
        error: 'Informe ao menos um parâmetro: nome, titular, processo, classe ou status',
      });
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    // contagem total (sem limit/offset)
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM marcas ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // ordenação: se buscou por nome usa relevância; senão usa data de concessão
    let orderBy;
    if (nome) {
      params.push(nome);
      orderBy = `ts_rank(search_vector, websearch_to_tsquery('portuguese', $${params.length})) DESC`;
    } else {
      orderBy = 'data_concessao DESC NULLS LAST';
    }

    params.push(limit, offset);
    const dataResult = await pool.query(
      `SELECT id, numero_processo, nome_marca, titular, pais, uf,
              classe_nice, status, despacho_codigo,
              data_deposito, data_concessao, data_vigencia,
              tipo_marca, natureza, procurador, numero_revista
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
    console.error('Erro em /marcas/buscar:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /marcas/:id
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt10(req.params.id, 0);
    if (!id) return res.status(400).json({ error: 'ID inválido' });

    const result = await pool.query('SELECT * FROM marcas WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Marca não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro em /marcas/:id:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
