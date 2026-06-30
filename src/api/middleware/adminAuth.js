const ADMIN_PASS = process.env.ADMIN_PASSWORD || '040995Joao@@';

module.exports = function adminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    const colon = decoded.indexOf(':');
    const pass = colon >= 0 ? decoded.slice(colon + 1) : decoded;
    if (pass === ADMIN_PASS) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="INPI Admin"');
  res.status(401).send('Senha incorreta');
};
