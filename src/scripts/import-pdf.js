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

function mesclarRegistros(base, novo) {
  return {
    ...base,
    nome_marca: novo.nome_marca || base.nome_marca,
    titular: novo.titular || base.titular,
    pais: novo.pais || base.pais,
    uf: novo.uf || base.uf,
    classe_nice: novo.classe_nice?.length ? novo.classe_nice : base.classe_nice,
    especificacao_nice: novo.especificacao_nice || base.especificacao_nice,
    classe_vienna: novo.classe_vienna?.length ? novo.classe_vienna : base.classe_vienna,
    status: novo.status || base.status,
    despacho_codigo: novo.despacho_codigo || base.despacho_codigo,
    despacho_complemento: novo.despacho_complemento || base.despacho_complemento,
    inpi_cod_pedido: novo.inpi_cod_pedido || base.inpi_cod_pedido,
    sobrestadores: novo.sobrestadores?.length ? novo.sobrestadores : base.sobrestadores,
    data_deposito: novo.data_deposito || base.data_deposito,
    data_concessao: novo.data_concessao || base.data_concessao,
    data_vigencia: novo.data_vigencia || base.data_vigencia,
    tipo_marca: novo.tipo_marca || base.tipo_marca,
    natureza: novo.natureza || base.natureza,
    procurador: novo.procurador || base.procurador,
    todos_despachos: [...(base.todos_despachos || []), ...(novo.todos_despachos || [])],
  };
}

async function lerJsonl(filePath, numeroRevista) {
  // O mesmo processo pode aparecer mais de uma vez na mesma RPI em PDF
  // (ex.: publicação + despacho de troca de procurador na mesma edição).
  // O XML agrupa isso num só <processo>; aqui precisamos mesclar manualmente
  // para nao tentar atualizar a mesma linha duas vezes no upsert em lote.
  const porProcesso = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed);
    if (!parsed.numero_processo) continue;
    const normalizado = normalizarRegistro(parsed, numeroRevista);
    const existente = porProcesso.get(normalizado.numero_processo);
    porProcesso.set(
      normalizado.numero_processo,
      existente ? mesclarRegistros(existente, normalizado) : normalizado
    );
  }

  return Array.from(porProcesso.values());
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
