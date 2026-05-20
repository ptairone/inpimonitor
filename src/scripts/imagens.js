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

async function baixarImagem(cookies, codPedido) {
  // Acessar detalhe para liberar a sessão para a imagem
  const r1 = await req(`${BASE}/servlet/MarcasServletController?Action=detail&CodPedido=${codPedido}`, {
    headers: { Cookie: cookieHeader(cookies) },
  });
  cookies = parseCookies(r1.headers, cookies);

  // Baixar imagem
  const r2 = await req(`${BASE}/servlet/LogoMarcasServletController?Action=image&codProcesso=${codPedido}`, {
    headers: { Cookie: cookieHeader(cookies) },
  });

  const ct = r2.headers['content-type'] || '';
  if (!ct.includes('image')) return null;
  return r2.body;
}

async function fetchImagem(numeroProcesso) {
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

  const imgPath = path.join(IMG_DIR, `${numeroProcesso}.jpg`);
  if (fs.existsSync(imgPath)) return imgPath;

  const cookies = await login();
  const { codPedido } = await buscarCodPedido(cookies, numeroProcesso);
  if (!codPedido) return null;

  const imgBuf = await baixarImagem(cookies, codPedido);
  if (!imgBuf) return null;

  fs.writeFileSync(imgPath, imgBuf);

  // Salvar o codPedido no banco para evitar nova busca
  await pool.query(
    `UPDATE marcas SET inpi_cod_pedido = $1 WHERE numero_processo = $2`,
    [codPedido, numeroProcesso]
  ).catch(() => {}); // ignora se coluna ainda nao existir

  return imgPath;
}

module.exports = { fetchImagem };
