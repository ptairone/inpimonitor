require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const pool = require('../config/database');
const { importarRegistros } = require('./importar');

function inferirNumeroRevista(filePath) {
  const match = filePath.match(/(?:RM|Marcas)?(\d{4})/i);
  return match ? Number(match[1]) : null;
}

function normalizarRegistro(raw, numeroRevista) {
  return {
    numero_processo: String(raw.numero_processo || ''),
    nome_marca: raw.nome_marca || null,
    titular: raw.titular || null,
    pais: raw.pais || null,
    uf: raw.uf || null,
    classe_nice: raw.classe_nice?.length ? raw.classe_nice.map(String) : null,
    especificacao_nice: raw.especificacao_nice && Object.keys(raw.especificacao_nice).length
      ? raw.especificacao_nice
      : null,
    classe_vienna: raw.classe_vienna?.length ? raw.classe_vienna.map(String) : null,
    status: raw.status || null,
    despacho_codigo: raw.despacho_codigo || null,
    despacho_complemento: raw.despacho_complemento || null,
    inpi_cod_pedido: raw.inpi_cod_pedido || null,
    sobrestadores: raw.sobrestadores?.length ? raw.sobrestadores : null,
    data_deposito: raw.data_deposito || null,
    data_concessao: raw.data_concessao || null,
    data_vigencia: raw.data_vigencia || null,
    tipo_marca: raw.tipo_marca || null,
    natureza: raw.natureza || null,
    procurador: raw.procurador || null,
    numero_revista: numeroRevista,
    todos_despachos: [{
      codigo: raw.despacho_codigo || '',
      texto: raw.status || null,
      complemento: raw.despacho_complemento || null,
    }],
  };
}

async function lerJsonl(filePath, numeroRevista) {
  const registros = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed);
    if (parsed.numero_processo) {
      registros.push(normalizarRegistro(parsed, numeroRevista));
    }
  }

  return registros;
}

async function main() {
  const jsonlPath = process.argv[2];
  const numeroArg = process.argv[3] ? Number(process.argv[3]) : null;

  if (!jsonlPath || !fs.existsSync(jsonlPath)) {
    throw new Error('Informe o arquivo JSONL gerado pelo extrator do PDF.');
  }

  const numeroRevista = numeroArg || inferirNumeroRevista(jsonlPath);
  if (!numeroRevista) {
    throw new Error('Informe o numero da revista como segundo argumento.');
  }

  const registros = await lerJsonl(jsonlPath, numeroRevista);
  const importados = await importarRegistros(registros, numeroRevista);
  console.log(`${importados} registros importados da RPI ${numeroRevista}.`);
}

main()
  .catch((err) => {
    console.error('Erro ao importar PDF:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
