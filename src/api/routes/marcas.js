const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { LIST_FIELDS, DETAIL_FIELDS, buildSort, parseClasses, parseInt10, isValidDate, toCsv } = require('../helpers');
const { searchLimiter } = require('../middleware/rateLimit');

function sendList(req, res, rows, meta) {
  if (req.query.formato === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="marcas.csv"');
    return res.send(toCsv(rows));
  }
  res.json({ data: rows, ...meta });
}

// GET /marcas/buscar
router.get('/buscar', searchLimiter, async (req, res) => {
  try {
    const {
      nome, fuzzy, titular, processo, status,
      uf, pais, tipo, natureza, procurador, despacho_codigo,
      deposito_de, deposito_ate,
      concessao_de, concessao_ate,
      vigencia_de, vigencia_ate,
      sort_by, sort_order, sem_contagem, vigente,
    } = req.query;

    const isFuzzy = fuzzy === 'true' && !!nome;
    const classes = parseClasses(req.query.classe);
    const page  = Math.max(1, parseInt10(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseInt10(req.query.limit, 20)));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];
    let fuzzyNomeIdx = null;

    const add = (condition, value) => {
      params.push(value);
      conditions.push(condition.replace('?', `$${params.length}`));
    };

    if (nome && !isFuzzy) add(`search_vector @@ websearch_to_tsquery('portuguese', ?)`, nome);
    if (isFuzzy) {
      params.push(nome);
      fuzzyNomeIdx = params.length;
      conditions.push(`similarity(nome_marca, $${fuzzyNomeIdx}) > 0.2`);
    }
    if (titular)         add(`titular ILIKE ?`, `%${titular}%`);
    if (processo)        add(`numero_processo = ?`, processo.trim());
    if (status)          add(`status ILIKE ?`, `%${status}%`);
    if (uf)              add(`uf ILIKE ?`, uf.trim());
    if (pais)            add(`pais ILIKE ?`, pais.trim());
    if (tipo)            add(`tipo_marca ILIKE ?`, `%${tipo}%`);
    if (natureza)        add(`natureza ILIKE ?`, `%${natureza}%`);
    if (procurador)      add(`procurador ILIKE ?`, `%${procurador}%`);
    if (despacho_codigo) add(`despacho_codigo = ?`, despacho_codigo.trim());

    if (classes.length === 1) {
      add(`? = ANY(classe_nice)`, classes[0]);
    } else if (classes.length > 1) {
      params.push(classes);
      conditions.push(`classe_nice && $${params.length}`);
    }

    if (vigente === 'true')  conditions.push('data_vigencia > CURRENT_DATE');
    if (vigente === 'false') conditions.push('(data_vigencia IS NULL OR data_vigencia <= CURRENT_DATE)');

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
          'nome', 'titular', 'processo',
          'classe (valor único ou separados por vírgula: 01,30)',
          'status', 'vigente (true|false)',
          'uf', 'pais', 'tipo', 'natureza', 'procurador', 'despacho_codigo',
          'deposito_de', 'deposito_ate', 'concessao_de', 'concessao_ate',
          'vigencia_de', 'vigencia_ate',
        ],
        opcoes: [
          'sort_by: nome_marca | data_deposito | data_concessao | data_vigencia | titular | updated_at',
          'sort_order: asc | desc (padrão: desc)',
          'sem_contagem: true — omite o total para resposta mais rápida',
          'formato: csv — retorna arquivo CSV',
          'page, limit (máx 100)',
        ],
      });
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    let total = null;
    if (sem_contagem !== 'true') {
      const countResult = await pool.query(`SELECT COUNT(*) FROM marcas ${whereClause}`, params);
      total = parseInt(countResult.rows[0].count, 10);
    }

    let orderBy;
    if (isFuzzy && !sort_by) {
      orderBy = `similarity(nome_marca, $${fuzzyNomeIdx}) DESC`;
    } else if (nome && !sort_by && !isFuzzy) {
      params.push(nome);
      orderBy = `ts_rank(search_vector, websearch_to_tsquery('portuguese', $${params.length})) DESC`;
    } else {
      orderBy = buildSort(sort_by, sort_order, 'data_concessao DESC NULLS LAST');
    }

    params.push(limit, offset);
    const dataResult = await pool.query(
      `SELECT ${LIST_FIELDS}
       FROM marcas
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const meta = { page, limit };
    if (total !== null) { meta.total = total; meta.paginas = Math.ceil(total / limit); }
    sendList(req, res, dataResult.rows, meta);
  } catch (err) {
    console.error('Erro em /marcas/buscar:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /marcas/vencendo?dias=90 — marcas que vencem nos próximos N dias
router.get('/vencendo', async (req, res) => {
  try {
    const dias  = Math.min(3650, Math.max(1, parseInt10(req.query.dias, 90)));
    const page  = Math.max(1, parseInt10(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseInt10(req.query.limit, 20)));
    const offset = (page - 1) * limit;
    const { sort_by, sort_order } = req.query;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM marcas
       WHERE data_vigencia >= CURRENT_DATE
         AND data_vigencia <= CURRENT_DATE + ($1 * INTERVAL '1 day')`,
      [dias]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const orderBy = buildSort(sort_by, sort_order, 'data_vigencia ASC NULLS LAST');
    const dataResult = await pool.query(
      `SELECT ${LIST_FIELDS}
       FROM marcas
       WHERE data_vigencia >= CURRENT_DATE
         AND data_vigencia <= CURRENT_DATE + ($1 * INTERVAL '1 day')
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [dias, limit, offset]
    );

    sendList(req, res, dataResult.rows, { dias, total, page, limit, paginas: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Erro em /marcas/vencendo:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /marcas/processo/:numero — detalhe completo por número do processo
router.get('/processo/:numero', async (req, res) => {
  try {
    const numero = req.params.numero.trim();
    const [marcaResult, historicoResult] = await Promise.all([
      pool.query(`SELECT ${DETAIL_FIELDS} FROM marcas WHERE numero_processo = $1`, [numero]),
      pool.query(
        `SELECT despacho_codigo, despacho_texto, numero_revista, created_at,
                (SELECT descricao FROM despacho_codigos WHERE codigo = despacho_codigo) AS despacho_descricao
         FROM historico_despachos
         WHERE numero_processo = $1
         ORDER BY numero_revista ASC`,
        [numero]
      ),
    ]);

    if (marcaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Processo não encontrado' });
    }
    res.json({ ...marcaResult.rows[0], historico: historicoResult.rows });
  } catch (err) {
    console.error('Erro em /marcas/processo/:numero:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /marcas/:id/similares — marcas com nome parecido (full-text)
router.get('/:id/similares', async (req, res) => {
  try {
    const id = parseInt10(req.params.id, 0);
    if (!id) return res.status(400).json({ error: 'ID inválido' });

    const refResult = await pool.query(
      'SELECT nome_marca FROM marcas WHERE id = $1', [id]
    );
    if (!refResult.rows.length || !refResult.rows[0].nome_marca) {
      return res.status(404).json({ error: 'Marca não encontrada ou sem nome' });
    }

    const nome = refResult.rows[0].nome_marca;
    const limit = Math.min(20, Math.max(1, parseInt10(req.query.limit, 10)));

    const result = await pool.query(
      `SELECT ${LIST_FIELDS},
              ts_rank(search_vector, websearch_to_tsquery('portuguese', $1)) AS relevancia
       FROM marcas
       WHERE search_vector @@ websearch_to_tsquery('portuguese', $1)
         AND id != $2
       ORDER BY relevancia DESC
       LIMIT $3`,
      [nome, id, limit]
    );

    res.json({ marca_referencia: nome, total: result.rows.length, data: result.rows });
  } catch (err) {
    console.error('Erro em /marcas/:id/similares:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /marcas/:id — detalhe completo por ID interno
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt10(req.params.id, 0);
    if (!id) return res.status(400).json({ error: 'ID inválido' });

    const [marcaResult, historicoResult] = await Promise.all([
      pool.query(`SELECT ${DETAIL_FIELDS} FROM marcas WHERE id = $1`, [id]),
      pool.query(
        `SELECT despacho_codigo, despacho_texto, numero_revista, created_at,
                (SELECT descricao FROM despacho_codigos WHERE codigo = despacho_codigo) AS despacho_descricao
         FROM historico_despachos
         WHERE numero_processo = (SELECT numero_processo FROM marcas WHERE id = $1)
         ORDER BY numero_revista ASC`,
        [id]
      ),
    ]);

    if (marcaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Marca não encontrada' });
    }
    res.json({ ...marcaResult.rows[0], historico: historicoResult.rows });
  } catch (err) {
    console.error('Erro em /marcas/:id:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
