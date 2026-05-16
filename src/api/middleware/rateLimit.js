const rateLimit = require('express-rate-limit');

const message = (windowSec) => ({
  error: `Muitas requisições. Tente novamente em ${windowSec} segundos.`,
});

// Limite geral: 120 requisições/minuto por IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: message(60),
});

// Limite para buscas pesadas: 40 requisições/minuto por IP
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: message(60),
});

module.exports = { globalLimiter, searchLimiter };
