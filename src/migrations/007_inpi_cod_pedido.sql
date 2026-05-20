-- Armazena o código interno do INPI (CodPedido) para evitar
-- nova busca no pePI ao servir a imagem novamente
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS inpi_cod_pedido VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_marcas_inpi_cod_pedido
  ON marcas(inpi_cod_pedido)
  WHERE inpi_cod_pedido IS NOT NULL;
