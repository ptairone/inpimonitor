// Proteção opcional por API Key — ativa somente se API_KEY estiver definida no .env
// Header obrigatório: X-API-Key: <chave>
function apiKeyMiddleware(req, res, next) {
  const key = process.env.API_KEY;
  if (!key) return next();

  const provided = req.headers['x-api-key'];
  if (!provided || provided !== key) {
    return res.status(401).json({ error: 'API key inválida ou ausente. Use o header X-API-Key.' });
  }
  next();
}

module.exports = apiKeyMiddleware;
