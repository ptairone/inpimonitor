require('dotenv').config();
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

const INPI_LOGIN = process.env.INPI_LOGIN;
const INPI_SENHA = process.env.INPI_SENHA;
const BASE = 'https://busca.inpi.gov.br/pePI';
const IMG_DIR = process.env.IMG_PATH || path.join(__dirname, '../../data/imagens');

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ...(opts.headers || {}),
      },
    };
    const r = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

// Extrai cookies de um objeto de headers
function parseCookies(headers, existing = {}) {
  const raw = headers['set-cookie'] || [];
  const cookies = { ...existing };
  for (const c of raw) {
    const [pair] = c.split(';');
    const [name, value] = pair.split('=');
    if (name && value !== undefined) cookies[name.trim()] = value.trim();
  }
  return cookies;
}

function cookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function login() {
  // 1. Pegar sessão inicial
  const r1 = await req(`${BASE}/`);
  let cookies = parseCookies(r1.headers);

  // 2. Login
  const body = new URLSearchParams({
    action: 'login', T_Login: INPI_LOGIN, T_Senha: INPI_SENHA, Usuario: '',
  }).toString();
  const r2 = await req(`${BASE}/servlet/LoginController`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(cookies) },
    body,
  });
  cookies = parseCookies(r2.headers, cookies);
  return cookies;
}

async function buscarCodPedido(cookies, numeroProcesso) {
  // Acessar página de busca
  const r1 = await req(`${BASE}/jsp/marcas/Pesquisa_num_processo.jsp`, {
    headers: { Cookie: cookieHeader(cookies) },
  });
  cookies = parseCookies(r1.headers, cookies);

  // Submeter busca
  const body = new URLSearchParams({
    NumPedido: numeroProcesso, NumGRU: '', NumProtocolo: '',
    NumInscricaoInternacional: '', botao: ' pesquisar  ',
    Action: 'searchMarca', tipoPesquisa: 'BY_NUM_PROC',
  }).toString();
  const r2 = await req(`${BASE}/servlet/MarcasServletController`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(cookies),
      Referer: `${BASE}/jsp/marcas/Pesquisa_num_processo.jsp`,
    },
    body,
  });
  cookies = parseCookies(r2.headers, cookies);
  const html = r2.body.toString('latin1');

  const match = html.match(/CodPedido=(\d+)/);
  return match ? { codPedido: match[1], cookies } : { codPedido: null, cookies };
}

async function acessarDetalhe(cookies, codPedido) {
  const r = await req(`${BASE}/servlet/MarcasServletController?Action=detail&CodPedido=${codPedido}`, {
    headers: { Cookie: cookieHeader(cookies) },
  });
  return { html: r.body.toString('latin1'), cookies: parseCookies(r.headers, cookies) };
}

async function baixarImagem(cookies, codPedido) {
  const { html, cookies: c2 } = await acessarDetalhe(cookies, codPedido);
  const r2 = await req(`${BASE}/servlet/LogoMarcasServletController?Action=image&codProcesso=${codPedido}`, {
    headers: { Cookie: cookieHeader(c2) },
  });
  const ct = r2.headers['content-type'] || '';
  if (!ct.includes('image')) return null;
  return r2.body;
}

function parsePeticoes(html) {
  // Remove tooltips (divs ocultos) antes de parsear para não sujar células
  const limpo = html.replace(/<div\b[^>]*VISIBILITY:\s*hidden[\s\S]*?<\/div>/gi, '');

  // Colunas: 0=Pgo, 1=Protocolo, 2=Data, 3=Img, 4=spacer, 5=Serviço, 6=Cliente, 7=ícone, 8=DataDelivery
  const peticoes = [];
  const rows = limpo.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    if (cells.length < 7 || !/^\d{12,}$/.test(cells[1])) continue;
    const img = cells[3] === '-' ? null : (cells[3] || null);
    const delivery = parseDataBR(cells[8]) || parseDataBR(cells[7]);
    peticoes.push({
      protocolo:     cells[1],
      data_peticao:  parseDataBR(cells[2]),
      numero_img:    img,
      servico:       cells[5] || null,
      cliente:       cells[6] || null,
      data_delivery: delivery,
    });
  }
  return peticoes;
}

function parseDataBR(str) {
  if (!str) return null;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function salvarPeticoes(numeroProcesso, peticoes) {
  if (!peticoes.length) return;
  for (const p of peticoes) {
    await pool.query(
      `INSERT INTO peticoes (numero_processo, protocolo, data_peticao, servico, cliente, numero_img, data_delivery)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (numero_processo, protocolo) DO UPDATE SET
         servico = EXCLUDED.servico, cliente = EXCLUDED.cliente,
         data_delivery = EXCLUDED.data_delivery`,
      [numeroProcesso, p.protocolo, p.data_peticao, p.servico, p.cliente, p.numero_img, p.data_delivery]
    ).catch(() => {});
  }
}

async function fetchImagem(numeroProcesso) {
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

  const imgPath = path.join(IMG_DIR, `${numeroProcesso}.jpg`);

  // O pePI é stateful: a sessão exige que a busca seja feita antes do detalhe
  let cookies = await login();
  const { codPedido, cookies: c2 } = await buscarCodPedido(cookies, numeroProcesso);
  cookies = c2;
  if (!codPedido) return null;

  // Salvar codPedido no banco para referência futura
  await pool.query(
    'UPDATE marcas SET inpi_cod_pedido = $1 WHERE numero_processo = $2',
    [codPedido, numeroProcesso]
  ).catch(() => {});

  // Acessar detalhe (com sessão preparada pela busca) e extrair petições
  const { html, cookies: c3 } = await acessarDetalhe(cookies, codPedido);
  cookies = c3;
  const peticoes = parsePeticoes(html);
  await salvarPeticoes(numeroProcesso, peticoes);

  // Imagem (usa cache se existir)
  if (!fs.existsSync(imgPath)) {
    const r = await req(`${BASE}/servlet/LogoMarcasServletController?Action=image&codProcesso=${codPedido}`, {
      headers: { Cookie: cookieHeader(cookies) },
    });
    const ct = r.headers['content-type'] || '';
    if (ct.includes('image')) fs.writeFileSync(imgPath, r.body);
    else return null;
  }

  return imgPath;
}

async function fetchPeticoes(numeroProcesso) {
  // Retorna petições do banco, buscando no INPI se não houver nenhuma
  const { rows } = await pool.query(
    'SELECT * FROM peticoes WHERE numero_processo = $1 ORDER BY data_peticao ASC',
    [numeroProcesso]
  );
  if (rows.length > 0) return rows;

  // Ainda não tem — buscar no INPI agora
  await fetchImagem(numeroProcesso); // aproveita o mesmo fluxo
  const { rows: rows2 } = await pool.query(
    'SELECT * FROM peticoes WHERE numero_processo = $1 ORDER BY data_peticao ASC',
    [numeroProcesso]
  );
  return rows2;
}

module.exports = { fetchImagem, fetchPeticoes };
