const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const {
  LIST_FIELDS, DETAIL_FIELDS, FROM_MARCAS, SITUACAO_WHERE,
  buildSort, parseClasses, parseInt10, isValidDate, toCsv,
} = require('../helpers');
const { fetchImagem, fetchPeticoes } = require('../../scripts/imagens');
const { searchLimiter } = require('../middleware/rateLimit');
const { cacheMiddleware } = require('../middleware/cache');

function sendList(req, res, rows, meta) {
  if (req.query.formato === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="marcas.csv"');
    return res.send(toCsv(rows));
  }
  res.json({ data: rows, ...meta });
}

// GET /marcas/autocomplete?q=X — sugestões rápidas de nome de marca (mín. 2 chars)
router.get('/autocomplete', searchLimiter, cacheMiddleware(60), async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);

    const result = await pool.query(
      `SELECT DISTINCT nome_marca
       FROM marcas
       WHERE nome_marca ILIKE $1 AND nome_marca IS NOT NULL
       ORDER BY nome_marca
       LIMIT 15`,
      [`${q.trim()}%`]
    );
    res.json(result.rows.map((r) => r.nome_marca));
  } catch (err) {
    console.error('Erro em /marcas/autocomplete:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /marcas/buscar
router.get('/buscar', searchLimiter, async (req, res) => {
  try {
    const {
      nome, fuzzy, titular, processo, status,
      uf, pais, tipo, natureza, procurador, despacho_codigo, despacho_categoria, situacao,
      deposito_de, deposito_ate,
      concessao_de, concessao_ate,
      vigencia_de, vigencia_ate,
      sort_by, sort_order, sem_contagem, vigente,
      numero_revista,
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

    if (nome && !isFuzzy) add(`marcas.search_vector @@ websearch_to_tsquery('portuguese', ?)`, nome);
    if (isFuzzy) {
      params.push(nome);
      fuzzyNomeIdx = params.length;
      conditions.push(`similarity(marcas.nome_marca, $${fuzzyNomeIdx}) > 0.2`);
    }
    if (titular)            add(`marcas.titular ILIKE ?`,          `%${titular}%`);
    if (processo)           add(`marcas.numero_processo = ?`,       processo.trim());
    if (status)             add(`marcas.status ILIKE ?`,            `%${status}%`);
    if (uf)                 add(`marcas.uf ILIKE ?`,                uf.trim());
    if (pais)               add(`marcas.pais ILIKE ?`,              pais.trim());
    if (tipo)               add(`marcas.tipo_marca ILIKE ?`,        `%${tipo}%`);
    if (natureza)           add(`marcas.natureza ILIKE ?`,          `%${natureza}%`);
    if (procurador)         add(`marcas.procurador ILIKE ?`,        `%${procurador}%`);
    if (despacho_codigo)    add(`marcas.despacho_codigo = ?`,       despacho_codigo.trim());
    if (despacho_categoria) add(`marcas.despacho_categoria = ?`,    despacho_categoria.trim());
    if (numero_revista)     add(`marcas.numero_revista = ?`,        parseInt10(numero_revista, null));

    // Filtro por situação canônica (agrupa todos os códigos de indeferimento, extinção etc.)
    if (situacao && SITUACAO_WHERE[situacao]) {
      conditions.push(SITUACAO_WHERE[situacao]);
    }

    if (classes.length === 1) {
      add(`? = ANY(marcas.classe_nice)`, classes[0]);
    } else if (classes.length > 1) {
      params.push(classes);
      conditions.push(`marcas.classe_nice && $${params.length}`);
    }

    if (vigente === 'true')  conditions.push('marcas.data_vigencia > CURRENT_DATE');
    if (vigente === 'false') conditions.push('(marcas.data_vigencia IS NULL OR marcas.data_vigencia <= CURRENT_DATE)');

    if (isValidDate(deposito_de))   add(`marcas.data_deposito >= ?`,  deposito_de);
    if (isValidDate(deposito_ate))  add(`marcas.data_deposito <= ?`,  deposito_ate);
    if (isValidDate(concessao_de))  add(`marcas.data_concessao >= ?`, concessao_de);
    if (isValidDate(concessao_ate)) add(`marcas.data_concessao <= ?`, concessao_ate);
    if (isValidDate(vigencia_de))   add(`marcas.data_vigencia >= ?`,  vigencia_de);
    if (isValidDate(vigencia_ate))  add(`marcas.data_vigencia <= ?`,  vigencia_ate);

    if (conditions.length === 0) {
      return res.status(400).json({
        error: 'Informe ao menos um parâmetro de busca',
        parametros: [
          'nome', 'titular', 'processo',
          'classe (valor único ou separados por vírgula: 01,30)',
          'status', 'vigente (true|false)',
          'uf', 'pais', 'tipo', 'natureza', 'procurador',
          'despacho_codigo', 'despacho_categoria',
          'situacao (vigor|analise|recurso|indeferido|extinto)',
          'deposito_de', 'deposito_ate', 'concessao_de', 'concessao_ate',
          'vigencia_de', 'vigencia_ate', 'numero_revista',
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
      const countResult = await pool.query(
        `SELECT COUNT(*) ${FROM_MARCAS} ${whereClause}`, params
      );
      total = parseInt(countResult.rows[0].count, 10);
    }

    let orderBy;
    if (isFuzzy && !sort_by) {
      orderBy = `similarity(marcas.nome_marca, $${fuzzyNomeIdx}) DESC`;
    } else if (nome && !sort_by && !isFuzzy) {
      params.push(nome);
      orderBy = `ts_rank(marcas.search_vector, websearch_to_tsquery('portuguese', $${params.length})) DESC`;
    } else {
      orderBy = buildSort(sort_by, sort_order, 'marcas.data_concessao DESC NULLS LAST');
    }

    params.push(limit, offset);
    const dataResult = await pool.query(
      `SELECT ${LIST_FIELDS}
       ${FROM_MARCAS}
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

// GET /marcas/vencendo?dias=90
router.get('/vencendo', async (req, res) => {
  try {
    const dias  = Math.min(3650, Math.max(1, parseInt10(req.query.dias, 90)));
    const page  = Math.max(1, parseInt10(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseInt10(req.query.limit, 20)));
    const offset = (page - 1) * limit;
    const { sort_by, sort_order } = req.query;

    const countResult = await pool.query(
      `SELECT COUNT(*) ${FROM_MARCAS}
       WHERE marcas.data_vigencia >= CURRENT_DATE
         AND marcas.data_vigencia <= CURRENT_DATE + ($1 * INTERVAL '1 day')`,
      [dias]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const orderBy = buildSort(sort_by, sort_order, 'marcas.data_vigencia ASC NULLS LAST');
    const dataResult = await pool.query(
      `SELECT ${LIST_FIELDS}
       ${FROM_MARCAS}
       WHERE marcas.data_vigencia >= CURRENT_DATE
         AND marcas.data_vigencia <= CURRENT_DATE + ($1 * INTERVAL '1 day')
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
      pool.query(
        `SELECT ${DETAIL_FIELDS} ${FROM_MARCAS} WHERE marcas.numero_processo = $1`,
        [numero]
      ),
      pool.query(
        `SELECT hd.despacho_codigo, hd.despacho_texto, hd.numero_revista, hd.created_at,
                dc2.descricao AS despacho_descricao
         FROM historico_despachos hd
         LEFT JOIN despacho_codigos dc2 ON dc2.codigo = hd.despacho_codigo
         WHERE hd.numero_processo = $1
         ORDER BY hd.numero_revista ASC`,
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

// GET /marcas/:id/similares
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
              ts_rank(marcas.search_vector, websearch_to_tsquery('portuguese', $1)) AS relevancia
       ${FROM_MARCAS}
       WHERE marcas.search_vector @@ websearch_to_tsquery('portuguese', $1)
         AND marcas.id != $2
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
      pool.query(
        `SELECT ${DETAIL_FIELDS} ${FROM_MARCAS} WHERE marcas.id = $1`,
        [id]
      ),
      pool.query(
        `SELECT hd.despacho_codigo, hd.despacho_texto, hd.numero_revista, hd.created_at,
                dc2.descricao AS despacho_descricao
         FROM historico_despachos hd
         LEFT JOIN despacho_codigos dc2 ON dc2.codigo = hd.despacho_codigo
         WHERE hd.numero_processo = (SELECT numero_processo FROM marcas WHERE id = $1)
         ORDER BY hd.numero_revista ASC`,
        [id]
      ),
    ]);

    if (marcaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Marca não encontrada' });
    }

    const marca = marcaResult.rows[0];

    const peticoesResult = await pool.query(
      'SELECT protocolo, data_peticao, servico, cliente, numero_img, data_delivery FROM peticoes WHERE numero_processo = $1 ORDER BY data_peticao ASC',
      [marca.numero_processo]
    );

    if (peticoesResult.rows.length === 0) {
      fetchPeticoes(marca.numero_processo).catch((err) =>
        console.error(`[marcas] Erro ao buscar petições ${marca.numero_processo}:`, err.message)
      );
    }

    res.json({
      ...marca,
      historico: historicoResult.rows,
      peticoes: peticoesResult.rows,
      tem_imagem: marca.tipo_marca === 'Mista' || marca.tipo_marca === 'Figurativa' || marca.tipo_marca === 'Tridimensional',
    });
  } catch (err) {
    console.error('Erro em /marcas/:id:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /marcas/:processo/imagem
router.get('/:processo/imagem', async (req, res) => {
  const { processo } = req.params;
  if (!/^\d+$/.test(processo)) return res.status(400).json({ error: 'Número de processo inválido' });

  try {
    const imgPath = await fetchImagem(processo);
    if (!imgPath) return res.status(404).json({ error: 'Imagem não disponível para este processo' });
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(imgPath);
  } catch (err) {
    console.error('Erro em /marcas/:processo/imagem:', err.message);
    res.status(500).json({ error: 'Erro ao buscar imagem' });
  }
});

module.exports = router;
