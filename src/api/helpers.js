const SORT_WHITELIST = {
  nome_marca:     'nome_marca',
  data_deposito:  'data_deposito',
  data_concessao: 'data_concessao',
  data_vigencia:  'data_vigencia',
  titular:        'titular',
  updated_at:     'updated_at',
};

// Campos para listagens (sem created_at, sem historico)
const LIST_FIELDS = `
  id, numero_processo, nome_marca, titular, pais, uf,
  classe_nice,
  CASE WHEN classe_nice IS NOT NULL THEN ARRAY(
    SELECT COALESCE(cd.descricao, u.cls)
    FROM unnest(classe_nice) WITH ORDINALITY AS u(cls, idx)
    LEFT JOIN classe_nice_descricoes cd ON cd.classe = u.cls
    ORDER BY u.idx
  ) END AS classe_descricoes,
  status, despacho_codigo,
  (SELECT descricao FROM despacho_codigos WHERE codigo = despacho_codigo) AS despacho_descricao,
  (SELECT categoria FROM despacho_codigos WHERE codigo = despacho_codigo) AS despacho_categoria,
  data_deposito, data_concessao, data_vigencia,
  tipo_marca, natureza, procurador, numero_revista,
  updated_at,
  (data_vigencia IS NOT NULL AND data_vigencia > CURRENT_DATE) AS vigente,
  CASE WHEN data_vigencia IS NOT NULL THEN (data_vigencia - CURRENT_DATE)::INT END AS dias_para_vencer
`;

// Campos para endpoints de detalhe (registro completo + historico)
const DETAIL_FIELDS = `
  id, numero_processo, nome_marca, titular, pais, uf,
  classe_nice,
  CASE WHEN classe_nice IS NOT NULL THEN ARRAY(
    SELECT COALESCE(cd.descricao, u.cls)
    FROM unnest(classe_nice) WITH ORDINALITY AS u(cls, idx)
    LEFT JOIN classe_nice_descricoes cd ON cd.classe = u.cls
    ORDER BY u.idx
  ) END AS classe_descricoes,
  status, despacho_codigo,
  (SELECT descricao FROM despacho_codigos WHERE codigo = despacho_codigo) AS despacho_descricao,
  (SELECT categoria FROM despacho_codigos WHERE codigo = despacho_codigo) AS despacho_categoria,
  data_deposito, data_concessao, data_vigencia,
  tipo_marca, natureza, procurador, numero_revista,
  created_at, updated_at,
  (data_vigencia IS NOT NULL AND data_vigencia > CURRENT_DATE) AS vigente,
  CASE WHEN data_vigencia IS NOT NULL THEN (data_vigencia - CURRENT_DATE)::INT END AS dias_para_vencer,
  CASE WHEN data_deposito IS NOT NULL THEN EXTRACT(YEAR FROM AGE(data_deposito))::INT END AS anos_desde_deposito
`;

function buildSort(sortBy, sortOrder, defaultSort) {
  const col = SORT_WHITELIST[sortBy];
  if (!col) return defaultSort;
  const dir = (sortOrder || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${dir} NULLS LAST`;
}

function parseClasses(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map((c) => c.trim()).filter(Boolean);
  return val.split(',').map((c) => c.trim()).filter(Boolean);
}

function parseInt10(val, def) {
  const n = parseInt(val, 10);
  return isNaN(n) ? def : n;
}

function isValidDate(str) {
  return str && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('; ') : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\r\n');
}

module.exports = { LIST_FIELDS, DETAIL_FIELDS, buildSort, parseClasses, parseInt10, isValidDate, toCsv };
