-- Captura o texto livre (<complemento>) de cada despacho publicado na RPI.
-- Para exigências traz o que o INPI pede; para indeferimentos traz os motivos;
-- para oposições traz quem protocolou, etc.

-- 1. Complemento do despacho atual na tabela principal
ALTER TABLE marcas
  ADD COLUMN IF NOT EXISTS despacho_complemento TEXT;

-- 2. Complemento por despacho no histórico completo
ALTER TABLE historico_despachos
  ADD COLUMN IF NOT EXISTS complemento TEXT;

-- 3. inpi_cod_pedido já existe (migration 007) — garante que está presente
ALTER TABLE marcas
  ADD COLUMN IF NOT EXISTS inpi_cod_pedido VARCHAR(30);

-- Índice para busca textual no complemento (casos de exigência, indeferimento etc.)
CREATE INDEX IF NOT EXISTS idx_historico_complemento_gin
  ON historico_despachos USING GIN(to_tsvector('portuguese', coalesce(complemento, '')))
  WHERE complemento IS NOT NULL;
