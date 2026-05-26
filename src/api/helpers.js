const SORT_WHITELIST = {
  nome_marca:     'marcas.nome_marca',
  data_deposito:  'marcas.data_deposito',
  data_concessao: 'marcas.data_concessao',
  data_vigencia:  'marcas.data_vigencia',
  titular:        'marcas.titular',
  updated_at:     'marcas.updated_at',
};

const FROM_MARCAS = `FROM marcas`;

// situacao_calculada usa despacho_categoria (coluna desnormalizada — sem JOIN)
// Prioridade: indeferido > extinto > recurso > vigor > analise
const SITUACAO_CASE = `
  CASE
    WHEN marcas.despacho_codigo IN ('157','158','159','IPAS015','IPAS017','IPAS018','IPAS024')
         OR marcas.status ILIKE '%indefer%'
      THEN 'indeferido'
    WHEN marcas.despacho_categoria = 'extincao'
         OR marcas.status ILIKE '%arquiv%'
         OR (marcas.data_vigencia IS NOT NULL
             AND marcas.data_vigencia <= CURRENT_DATE
             AND marcas.data_concessao IS NOT NULL)
      THEN 'extinto'
    WHEN marcas.despacho_categoria IN ('recurso','nulidade')
      THEN 'recurso'
    WHEN marcas.data_vigencia IS NOT NULL
         AND marcas.data_vigencia > CURRENT_DATE
         AND marcas.despacho_categoria = 'concessao'
      THEN 'vigor'
    ELSE 'analise'
  END`;

const SITUACAO_WHERE = {
  indeferido: `(marcas.despacho_codigo IN ('157','158','159','IPAS015','IPAS017','IPAS018','IPAS024') OR marcas.status ILIKE '%indefer%')`,
  extinto:    `(marcas.despacho_categoria = 'extincao' OR marcas.status ILIKE '%arquiv%' OR (marcas.data_vigencia IS NOT NULL AND marcas.data_vigencia <= CURRENT_DATE AND marcas.data_concessao IS NOT NULL))`,
  recurso:    `marcas.despacho_categoria IN ('recurso','nulidade')`,
  vigor:      `(marcas.data_vigencia IS NOT NULL AND marcas.data_vigencia > CURRENT_DATE AND marcas.despacho_categoria = 'concessao')`,
};

const LIST_FIELDS = `
  marcas.id, marcas.numero_processo, marcas.nome_marca, marcas.titular, marcas.pais, marcas.uf,
  marcas.classe_nice,
  CASE WHEN marcas.classe_nice IS NOT NULL THEN ARRAY(
    SELECT COALESCE(cnd.descricao, u.cls)
    FROM unnest(marcas.classe_nice) WITH ORDINALITY AS u(cls, idx)
    LEFT JOIN classe_nice_descricoes cnd ON cnd.classe = u.cls
    ORDER BY u.idx
  ) END AS classe_descricoes,
  marcas.status, marcas.despacho_codigo,
  marcas.despacho_descricao,
  marcas.despacho_categoria,
  marcas.data_deposito, marcas.data_concessao, marcas.data_vigencia,
  marcas.tipo_marca, marcas.natureza, marcas.procurador, marcas.numero_revista,
  marcas.updated_at,
  (marcas.data_vigencia IS NOT NULL AND marcas.data_vigencia > CURRENT_DATE) AS vigente,
  CASE WHEN marcas.data_vigencia IS NOT NULL
    THEN (marcas.data_vigencia - CURRENT_DATE)::INT
  END AS dias_para_vencer,
  ${SITUACAO_CASE} AS situacao_calculada
`;

const DETAIL_FIELDS = `
  marcas.id, marcas.numero_processo, marcas.nome_marca, marcas.titular, marcas.pais, marcas.uf,
  marcas.classe_nice,
  CASE WHEN marcas.classe_nice IS NOT NULL THEN ARRAY(
    SELECT COALESCE(cnd.descricao, u.cls)
    FROM unnest(marcas.classe_nice) WITH ORDINALITY AS u(cls, idx)
    LEFT JOIN classe_nice_descricoes cnd ON cnd.classe = u.cls
    ORDER BY u.idx
  ) END AS classe_descricoes,
  marcas.especificacao_nice, marcas.classe_vienna,
  marcas.status, marcas.despacho_codigo,
  marcas.despacho_descricao,
  marcas.despacho_categoria,
  marcas.despacho_complemento,
  marcas.inpi_cod_pedido,
  marcas.data_deposito, marcas.data_concessao, marcas.data_vigencia,
  marcas.tipo_marca, marcas.natureza, marcas.procurador, marcas.numero_revista,
  marcas.created_at, marcas.updated_at,
  (marcas.data_vigencia IS NOT NULL AND marcas.data_vigencia > CURRENT_DATE) AS vigente,
  CASE WHEN marcas.data_vigencia IS NOT NULL
    THEN (marcas.data_vigencia - CURRENT_DATE)::INT
  END AS dias_para_vencer,
  CASE WHEN marcas.data_deposito IS NOT NULL
    THEN EXTRACT(YEAR FROM AGE(marcas.data_deposito))::INT
  END AS anos_desde_deposito,
  ${SITUACAO_CASE} AS situacao_calculada
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
  return '﻿' + lines.join('\r\n');
}

module.exports = {
  LIST_FIELDS, DETAIL_FIELDS,
  FROM_MARCAS, SITUACAO_CASE, SITUACAO_WHERE,
  buildSort, parseClasses, parseInt10, isValidDate, toCsv,
};
