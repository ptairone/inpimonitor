const fs = require('fs');
const pool = require('../config/database');

const BATCH_SIZE = 500;

function parseDate(str) {
  if (!str) return null;
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  if (!y || y.length !== 4) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseTxt(content) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const records = [];
  let current = null;
  let despachoLines = [];

  const flush = () => {
    if (!current) return;
    current.status = despachoLines.join(' ').replace(/\s+/g, ' ').trim() || null;
    records.push(current);
    current = null;
    despachoLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('No.')) {
      flush();
      const m = line.match(/^No\.(\d+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\S+)/);
      current = {
        numero_processo: m ? m[1] : line.slice(3).trim().split(/\s+/)[0],
        data_deposito: m ? parseDate(m[2]) : null,
        despacho_codigo: m ? m[3] : null,
        nome_marca: null,
        titular: null,
        pais: null,
        uf: null,
        classe_nice: [],
        status: null,
        tipo_marca: null,
        natureza: null,
        procurador: null,
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith('Tit.')) {
      const val = line.slice(4).trim();
      const cm = val.match(/\(([A-Z]{2})(?:\/([A-Z]{2}))?\)\s*$/);
      if (cm) {
        current.pais = cm[1];
        current.uf = cm[2] || null;
        current.titular = val.slice(0, val.lastIndexOf('(')).trim();
      } else {
        current.titular = val;
      }
    } else if (line.startsWith('Marca:')) {
      current.nome_marca = line.slice(6).trim() || null;
    } else if (line.startsWith('Apres.:')) {
      const am = line.match(/Apres\.\:\s*([^;]+)/);
      const nm = line.match(/Nat\.\:\s*(.+)/);
      if (am) current.tipo_marca = am[1].trim();
      if (nm) current.natureza = nm[1].trim();
    } else if (line.startsWith('Clas.Prod/Serv:')) {
      current.classe_nice = line
        .slice(15).trim()
        .split(/\s*;\s*/)
        .map((c) => c.split('.')[0].trim())
        .filter(Boolean);
    } else if (line.startsWith('Procurador:')) {
      current.procurador = line.slice(11).trim() || null;
    } else if (line.startsWith('*')) {
      despachoLines.push(line.replace(/^\*|\*$/g, '').trim());
    }
  }

  flush();
  return records;
}

async function upsertBatch(client, batch, numeroRevista) {
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
      r.data_deposito, null, null,
      r.tipo_marca, r.natureza, r.procurador, numeroRevista
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
       tipo_marca      = EXCLUDED.tipo_marca,
       natureza        = EXCLUDED.natureza,
       procurador      = COALESCE(EXCLUDED.procurador, marcas.procurador),
       numero_revista  = EXCLUDED.numero_revista
     WHERE EXCLUDED.numero_revista >= marcas.numero_revista`,
    params
  );

  await upsertHistoricoBatch(client, batch, numeroRevista);
}

async function upsertHistoricoBatch(client, batch, numeroRevista) {
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
    params.push(r.numero_processo, r.despacho_codigo, r.status, numeroRevista);
  }

  await client.query(
    `INSERT INTO historico_despachos (numero_processo, despacho_codigo, despacho_texto, numero_revista)
     VALUES ${placeholders}
     ON CONFLICT (numero_processo, numero_revista, (COALESCE(despacho_codigo, ''))) DO NOTHING`,
    params
  );
}

async function importarRevistaTxt(txtPath, numero) {
  const content = fs.readFileSync(txtPath, 'latin1');
  const raw = parseTxt(content).filter((r) => r.numero_processo);
  const map = new Map();
  for (const r of raw) map.set(r.numero_processo, r);
  const registros = Array.from(map.values());

  const client = await pool.connect();
  let importados = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < registros.length; i += BATCH_SIZE) {
      const batch = registros.slice(i, i + BATCH_SIZE);
      await upsertBatch(client, batch, numero);
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

module.exports = { importarRevistaTxt };
