-- Permite múltiplos despachos por (processo, revista) em historico_despachos
-- e protege o upsert de marcas contra sobrescrita por dados mais antigos

-- 1. Remove a constraint antiga que limitava a 1 entrada por (processo, revista)
ALTER TABLE historico_despachos
  DROP CONSTRAINT IF EXISTS historico_despachos_processo_revista_unique;

-- 2. Índice funcional: trata NULL em despacho_codigo como string vazia
--    para que ON CONFLICT funcione mesmo quando o código é nulo
CREATE UNIQUE INDEX IF NOT EXISTS idx_hd_unique_processo_revista_codigo
  ON historico_despachos(numero_processo, numero_revista, COALESCE(despacho_codigo, ''));

-- 3. Índice de apoio para a coluna despacho_codigo (queries por código)
CREATE INDEX IF NOT EXISTS idx_historico_codigo_v2
  ON historico_despachos(despacho_codigo)
  WHERE despacho_codigo IS NOT NULL;
