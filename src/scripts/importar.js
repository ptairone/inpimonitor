const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const pool = require('../config/database');

const BATCH_SIZE = 500;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) =>
    ['processo', 'despacho', 'titular', 'classe-nice', 'classe-vienna', 'sobrestador'].includes(name),
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
});

function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  if (!d || !m || !y || y.length !== 4) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function extrairTexto(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val.trim() || null;
  if (typeof val === 'number') return String(val);
  return null;
}

function extrairProcesso(proc, numeroRevista) {
  const numero = proc['@_numero'];
  if (!numero) return null;

  const dataDeposito = parseDate(proc['@_data-deposito']);
  const dataConcessao = parseDate(proc['@_data-concessao']);
  const dataVigencia = parseDate(proc['@_data-vigencia']);

  const despachos = proc.despachos?.despacho || [];
  const despacho = despachos[0] || {};
  const despachoNome = extrairTexto(despacho['@_nome']);
  const despachoCodigo = extrairTexto(despacho['@_codigo']);

  const titulares = proc.titulares?.titular || [];
  const titular =
    titulares
      .map((t) => extrairTexto(t['@_nome-razao-social']))
      .filter(Boolean)
      .join(' | ') || null;
  const pais = extrairTexto(titulares[0]?.['@_pais']);
  const uf = extrairTexto(titulares[0]?.['@_uf']);

  const marca = proc.marca && typeof proc.marca === 'object' ? proc.marca : {};
  const nomeMarca = extrairTexto(marca.nome);
  const tipoMarca = extrairTexto(marca['@_apresentacao']);
  const natureza = extrairTexto(marca['@_natureza']);

  const listaClasse = proc['lista-classe-nice']?.['classe-nice'] || [];
  const classeNice = listaClasse.map((c) => extrairTexto(c['@_codigo'])).filter(Boolean);

  const procurador = extrairTexto(proc.procurador);

  return {
    numero_processo: String(numero),
    nome_marca: nomeMarca,
    titular,
    pais,
    uf,
    classe_nice: classeNice,
    status: despachoNome,
    despacho_codigo: despachoCodigo,
    data_deposito: dataDeposito,
    data_concessao: dataConcessao,
    data_vigencia: dataVigencia,
    tipo_marca: tipoMarca,
    natureza,
    procurador,
    numero_revista: numeroRevista,
  };
}

async function upsertBatch(client, batch) {
  if (batch.length === 0) return;

  const COLS = 15;
  const placeholders = batch
    .map((_, i) => {
      const b = i * COLS;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15})`;
    })
    .join(',');

  const params = [];
  for (const r of batch) {
    params.push(
      r.numero_processo, r.nome_marca, r.titular, r.pais, r.uf,
      r.classe_nice, r.status, r.despacho_codigo,
      r.data_deposito, r.data_concessao, r.data_vigencia,
      r.tipo_marca, r.natureza, r.procurador, r.numero_revista
    );
  }

  await client.query(
    `INSERT INTO marcas (
       numero_processo, nome_marca, titular, pais, uf, classe_nice,
       status, despacho_codigo, data_deposito, data_concessao, data_vigencia,
       tipo_marca, natureza, procurador, numero_revista
     ) VALUES ${placeholders}
     ON CONFLICT (numero_processo) DO UPDATE SET
       nome_marca      = EXCLUDED.nome_marca,
       titular         = EXCLUDED.titular,
       pais            = EXCLUDED.pais,
       uf              = EXCLUDED.uf,
       classe_nice     = EXCLUDED.classe_nice,
       status          = EXCLUDED.status,
       despacho_codigo = EXCLUDED.despacho_codigo,
       data_deposito   = EXCLUDED.data_deposito,
       data_concessao  = EXCLUDED.data_concessao,
       data_vigencia   = EXCLUDED.data_vigencia,
       tipo_marca      = EXCLUDED.tipo_marca,
       natureza        = EXCLUDED.natureza,
       procurador      = COALESCE(EXCLUDED.procurador, marcas.procurador),
       numero_revista  = EXCLUDED.numero_revista`,
    params
  );

  await upsertHistoricoBatch(client, batch);
}

async function upsertHistoricoBatch(client, batch) {
  if (batch.length === 0) return;
  const COLS = 4;
  const placeholders = batch
    .map((_, i) => {
      const b = i * COLS;
      return `($${b+1},$${b+2},$${b+3},$${b+4})`;
    })
    .join(',');

  const params = [];
  for (const r of batch) {
    params.push(r.numero_processo, r.despacho_codigo, r.status, r.numero_revista);
  }

  await client.query(
    `INSERT INTO historico_despachos (numero_processo, despacho_codigo, despacho_texto, numero_revista)
     VALUES ${placeholders}
     ON CONFLICT (numero_processo, numero_revista) DO NOTHING`,
    params
  );
}

async function importarRevista(xmlPath, numero) {
  const xml = fs.readFileSync(xmlPath, 'utf8');

  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    throw new Error(`XML malformado: ${err.message}`);
  }

  const processos = parsed?.revista?.processo || [];
  const registros = processos.map((p) => extrairProcesso(p, numero)).filter(Boolean);

  const client = await pool.connect();
  let importados = 0;
  try {
    await client.query('BEGIN');

    for (let i = 0; i < registros.length; i += BATCH_SIZE) {
      const batch = registros.slice(i, i + BATCH_SIZE);
      await upsertBatch(client, batch);
      importados += batch.length;
    }

    await client.query(
      `UPDATE revistas_controle
       SET importado = TRUE, data_importacao = NOW(), total_registros = $1
       WHERE numero_revista = $2`,
      [importados, numero]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return importados;
}

module.exports = { importarRevista };
