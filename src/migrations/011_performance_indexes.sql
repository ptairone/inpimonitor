-- Migration 011: índices de performance para buscas ILIKE e ordenações
-- titular e procurador usam ILIKE '%nome%' — GIN trigram é o único índice que cobre isso
-- datas são usadas em ORDER BY e WHERE com CURRENT_DATE

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marcas_titular_trgm
  ON marcas USING gin (titular gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marcas_procurador_trgm
  ON marcas USING gin (procurador gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marcas_data_vigencia
  ON marcas (data_vigencia)
  WHERE data_vigencia IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marcas_data_deposito
  ON marcas (data_deposito)
  WHERE data_deposito IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marcas_data_concessao
  ON marcas (data_concessao)
  WHERE data_concessao IS NOT NULL;
