-- Extensão pg_trgm para busca por similaridade fonética/trigrama
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índice GIN para busca fuzzy pelo nome da marca
CREATE INDEX IF NOT EXISTS idx_marcas_nome_trgm ON marcas USING gin (nome_marca gin_trgm_ops);

-- Tabela de webhooks para notificações de vencimento
CREATE TABLE IF NOT EXISTS webhooks (
  id        SERIAL       PRIMARY KEY,
  url       TEXT         NOT NULL,
  evento    VARCHAR(30)  NOT NULL DEFAULT 'vencimento',
  min_dias  INT          NOT NULL DEFAULT 30,
  ativo     BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_ativo ON webhooks(ativo) WHERE ativo = TRUE;
