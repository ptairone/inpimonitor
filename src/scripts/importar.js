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

  const inpiCodPedido = extrairTexto(proc['@_cod-pedido']);

  const despachos = proc.despachos?.despacho || [];
  const despacho = despachos[0] || {};
  const despachoNome = extrairTexto(despacho['@_nome']);
  const despachoCodigo = extrairTexto(despacho['@_codigo']);
  // <texto-complementar> (revistas XML modernas) ou <complemento> (formato antigo TXT)
  // contém o texto livre do despacho: motivos de indeferimento, exigências, oposições, etc.
  const despachoComplemento =
    extrairTexto(despacho['texto-complementar']) || extrairTexto(despacho.complemento);

  const todosDespachos = despachos.map((d) => ({
    codigo: extrairTexto(d['@_codigo']) || '',
    texto: extrairTexto(d['@_nome']),
    complemento: extrairTexto(d['texto-complementar']) || extrairTexto(d.complemento),
  }));

  // Processos que estão sobrestando este pedido (colisão de marca)
  const sobrestadores = (proc.sobrestadores?.sobrestador || []).map((s) => ({
    processo: extrairTexto(s['@_processo']),
    marca: extrairTexto(s['@_marca']),
  })).filter((s) => s.processo);

  const titulares = proc.titulares?.titular || [];
  const titular =
    titulares
      .map((t) => extrairTexto(t['@_nome-razao-social']))
      .filter(Boolean)
      .join(' | ') || null;
  const pais = extrairTexto(titulares[0]?.['@_pais']);
  const uf = extrairTexto(titulares[0]?.['@_uf']);

  const marca = proc.marca && typeof proc.marca === 'object' ? proc.marca : {};
  // formato antigo: <marca apresentacao="X">NOME</marca> → #text
  // formato novo:   <marca apresentacao="X"><nome>NOME</nome></marca> → .nome
  const nomeMarca = extrairTexto(marca.nome) || extrairTexto(marca['#text']);
  const tipoMarca = extrairTexto(marca['@_apresentacao']);
  const natureza = extrairTexto(marca['@_natureza']);

  const listaClasse = proc['lista-classe-nice']?.['classe-nice'] || [];
  // null quando vazio — array vazio [] quebraria o COALESCE no upsert
  const classeNice = listaClasse.map((c) => extrairTexto(c['@_codigo'])).filter(Boolean);

  // Especificação por classe Nice: { "43": "Aluguel de acomodações..." }
  const especificacaoNice = {};
  for (const c of listaClasse) {
    const cod = extrairTexto(c['@_codigo']);
    const esp = extrairTexto(c.especificacao);
    if (cod && esp) especificacaoNice[cod] = esp.replace(/;\s*$/, '').trim();
  }

  // Classificação de Viena: ["7.1.8", "29.1.15", ...]
  const listaViena = proc['classes-vienna']?.['classe-vienna'] || [];
  const classeViena = listaViena.map((v) => extrairTexto(v['@_codigo'])).filter(Boolean);

  const procurador = extrairTexto(proc.procurador);

  return {
    numero_processo: String(numero),
    nome_marca: nomeMarca,
    titular,
    pais,
    uf,
    classe_nice: classeNice.length ? classeNice : null,
    especificacao_nice: Object.keys(especificacaoNice).length ? especificacaoNice : null,
    classe_vienna: classeViena.length ? classeViena : null,
    status: despachoNome,
    despacho_codigo: despachoCodigo,
    despacho_complemento: despachoComplemento,
    inpi_cod_pedido: inpiCodPedido,
    sobrestadores: sobrestadores.length ? sobrestadores : null,
    data_deposito: dataDeposito,
    data_concessao: dataConcessao,
    data_vigencia: dataVigencia,
    tipo_marca: tipoMarca,
    natureza,
    procurador,
    numero_revista: numeroRevista,
    todos_despachos: todosDespachos,
  };
}

async function upsertBatch(client, batch) {
  if (batch.length === 0) return;

  const COLS = 20;
  const placeholders = batch
    .map((_, i) => {
      const b = i * COLS;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17},$${b+18},$${b+19},$${b+20})`;
    })
    .join(',');

  const params = [];
  for (const r of batch) {
    params.push(
      r.numero_processo, r.nome_marca, r.titular, r.pais, r.uf,
      r.classe_nice, r.status, r.despacho_codigo,
      r.data_deposito, r.data_concessao, r.data_vigencia,
      r.tipo_marca, r.natureza, r.procurador, r.numero_revista,
      r.especificacao_nice ? JSON.stringify(r.especificacao_nice) : null,
      r.classe_vienna,
      r.despacho_complemento,
      r.inpi_cod_pedido,
      r.sobrestadores ? JSON.stringify(r.sobrestadores) : null
    );
  }

  await client.query(
    `INSERT INTO marcas (
       numero_processo, nome_marca, titular, pais, uf, classe_nice,
       status, despacho_codigo, data_deposito, data_concessao, data_vigencia,
       tipo_marca, natureza, procurador, numero_revista,
       especificacao_nice, classe_vienna, despacho_complemento, inpi_cod_pedido, sobrestadores
     ) VALUES ${placeholders}
     ON CONFLICT (numero_processo) DO UPDATE SET
       titular              = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN COALESCE(EXCLUDED.titular, marcas.titular) ELSE marcas.titular END,
       pais                 = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN COALESCE(EXCLUDED.pais, marcas.pais) ELSE marcas.pais END,
       uf                   = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN COALESCE(EXCLUDED.uf,   marcas.uf)   ELSE marcas.uf END,
       classe_nice          = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN COALESCE(EXCLUDED.classe_nice, marcas.classe_nice) ELSE marcas.classe_nice END,
       especificacao_nice   = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN COALESCE(EXCLUDED.especificacao_nice, marcas.especificacao_nice)  ELSE marcas.especificacao_nice END,
       classe_vienna        = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN COALESCE(EXCLUDED.classe_vienna,      marcas.classe_vienna)       ELSE marcas.classe_vienna END,
       status               = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN EXCLUDED.status               ELSE marcas.status END,
       despacho_codigo      = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN EXCLUDED.despacho_codigo      ELSE marcas.despacho_codigo END,
       despacho_complemento = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN EXCLUDED.despacho_complemento ELSE marcas.despacho_complemento END,
       sobrestadores        = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN COALESCE(EXCLUDED.sobrestadores, marcas.sobrestadores) ELSE marcas.sobrestadores END,
       data_concessao       = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN COALESCE(EXCLUDED.data_concessao, marcas.data_concessao) ELSE marcas.data_concessao END,
       data_vigencia        = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN COALESCE(EXCLUDED.data_vigencia,  marcas.data_vigencia)  ELSE marcas.data_vigencia END,
       procurador           = CASE WHEN EXCLUDED.numero_revista >= marcas.numero_revista THEN COALESCE(EXCLUDED.procurador,     marcas.procurador)     ELSE marcas.procurador END,
       numero_revista       = GREATEST(marcas.numero_revista, EXCLUDED.numero_revista),
       nome_marca           = COALESCE(marcas.nome_marca,    EXCLUDED.nome_marca),
       tipo_marca           = COALESCE(marcas.tipo_marca,    EXCLUDED.tipo_marca),
       natureza             = COALESCE(marcas.natureza,      EXCLUDED.natureza),
       data_deposito        = COALESCE(marcas.data_deposito, EXCLUDED.data_deposito),
       inpi_cod_pedido      = COALESCE(marcas.inpi_cod_pedido, EXCLUDED.inpi_cod_pedido)`,
    params
  );

  // Sincroniza despacho_categoria e despacho_descricao para o batch recém inserido/atualizado
  const processosBatch = batch.map((r) => r.numero_processo);
  await client.query(
    `UPDATE marcas m
     SET despacho_categoria = dc.categoria,
         despacho_descricao  = dc.descricao
     FROM despacho_codigos dc
     WHERE dc.codigo = m.despacho_codigo
       AND m.numero_processo = ANY($1)`,
    [processosBatch]
  );

  await upsertHistoricoBatch(client, batch);
}

async function upsertHistoricoBatch(client, batch) {
  if (batch.length === 0) return;

  const seen = new Map();
  for (const r of batch) {
    const despachos = r.todos_despachos?.length
      ? r.todos_despachos
      : [{ codigo: r.despacho_codigo || '', texto: r.status }];
    for (const d of despachos) {
      const codigo = d.codigo || '';
      const key = `${r.numero_processo}|${r.numero_revista}|${codigo}`;
      seen.set(key, { numero_processo: r.numero_processo, codigo, texto: d.texto, complemento: d.complemento || null, revista: r.numero_revista, procurador: r.procurador });
    }
  }
  const registros = Array.from(seen.values());

  const COLS = 6;
  const placeholders = registros
    .map((_, i) => { const b = i * COLS; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`; })
    .join(',');

  const params = [];
  for (const r of registros) {
    params.push(r.numero_processo, r.codigo, r.texto, r.revista, r.procurador, r.complemento);
  }

  await client.query(
    `INSERT INTO historico_despachos (numero_processo, despacho_codigo, despacho_texto, numero_revista, procurador, complemento)
     VALUES ${placeholders}
     ON CONFLICT (numero_processo, numero_revista, (COALESCE(despacho_codigo, '')))
     DO UPDATE SET
       procurador  = COALESCE(historico_despachos.procurador,  EXCLUDED.procurador),
       complemento = COALESCE(historico_despachos.complemento, EXCLUDED.complemento)`,
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

async function importarRegistros(registros, numero) {
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
      `INSERT INTO revistas_controle (numero_revista, baixado, importado, data_download, data_importacao, total_registros)
       VALUES ($1, TRUE, TRUE, NOW(), NOW(), $2)
       ON CONFLICT (numero_revista) DO UPDATE
         SET baixado = TRUE,
             importado = TRUE,
             data_importacao = NOW(),
             total_registros = $2`,
      [numero, importados]
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

module.exports = { importarRevista, importarRegistros };
