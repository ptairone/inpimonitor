const express = require('express');
const router = express.Router();
const pool = require('../../config/database');

function parseInt10(val, def) {
  const n = parseInt(val, 10);
  return isNaN(n) ? def : n;
}

function isValidDate(str) {
  return str && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

// GET /marcas/buscar
router.get('/buscar', async (req, res) => {
  try {
    const {
      nome, titular, processo, classe, status,
      uf, pais, tipo, natureza, procurador, despacho_codigo,
      deposito_de, deposito_ate,
      concessao_de, concessao_ate,
      vigencia_de, vigencia_ate,
    } = req.query;

    const page = Math.max(1, parseInt10(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseInt10(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    const add = (condition, value) => {
      params.push(value);
      conditions.push(condition.replace('?', `$${params.length}`));
    };

    if (nome)            add(`search_vector @@ websearch_to_tsquery('portuguese', ?)`, nome);
    if (titular)         add(`titular ILIKE ?`, `%${titular}%`);
    if (processo)        add(`numero_processo = ?`, processo.trim());
    if (classe)          add(`? = ANY(classe_nice)`, classe.trim());
    if (status)          add(`status ILIKE ?`, `%${status}%`);
    if (uf)              add(`uf ILIKE ?`, uf.trim());
    if (pais)            add(`pais ILIKE ?`, pais.trim());
    if (tipo)            add(`tipo_marca ILIKE ?`, `%${tipo}%`);
    if (natureza)        add(`natureza ILIKE ?`, `%${natureza}%`);
    if (procurador)      add(`procurador ILIKE ?`, `%${procurador}%`);
    if (despacho_codigo) add(`despacho_codigo = ?`, despacho_codigo.trim());

    if (isValidDate(deposito_de))   add(`data_deposito >= ?`, deposito_de);
    if (isValidDate(deposito_ate))  add(`data_deposito <= ?`, deposito_ate);
    if (isValidDate(concessao_de))  add(`data_concessao >= ?`, concessao_de);
    if (isValidDate(concessao_ate)) add(`data_concessao <= ?`, concessao_ate);
    if (isValidDate(vigencia_de))   add(`data_vigencia >= ?`, vigencia_de);
    if (isValidDate(vigencia_ate))  add(`data_vigencia <= ?`, vigencia_ate);

    if (conditions.length === 0) {
      return res.status(400).json({
        error: 'Informe ao menos um parâmetro de busca',
        parametros: [
          'nome', 'titular', 'processo', 'classe', 'status',
          'uf', 'pais', 'tipo', 'natureza', 'procurador', 'despacho_codigo',
          'deposito_de', 'deposito_ate', 'concessao_de', 'concessao_ate',
          'vigencia_de', 'vigencia_ate',
        ],
      });
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM marcas ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

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

// GET /marcas/processo/:numero — busca por número do processo com detalhes completos
router.get('/processo/:numero', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM marcas WHERE numero_processo = $1',
      [req.params.numero.trim()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Processo não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro em /marcas/processo/:numero:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /marcas/:id — busca por ID interno
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
