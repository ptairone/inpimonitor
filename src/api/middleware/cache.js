const NodeCache = require('node-cache');

const store = new NodeCache({ useClones: false });

function cacheMiddleware(ttlSeconds) {
  return (req, res, next) => {
    if (req.query.formato === 'csv') return next();

    const key = req.originalUrl;
    const hit = store.get(key);
    if (hit !== undefined) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(hit);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      res.json = originalJson;
      if (res.statusCode < 400) store.set(key, body, ttlSeconds);
      res.setHeader('X-Cache', 'MISS');
      return originalJson(body);
    };
    next();
  };
}

function invalidatePrefix(prefix) {
  store.keys()
    .filter((k) => k.startsWith(prefix))
    .forEach((k) => store.del(k));
}

module.exports = { cacheMiddleware, invalidatePrefix };
