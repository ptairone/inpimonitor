-- Classificação de Viena (array de códigos ex: ["7.1.8", "29.1.15"])
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS classe_vienna TEXT[];

-- Especificação das classes Nice (ex: {"43": "Aluguel de acomodações..."})
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS especificacao_nice JSONB;

CREATE INDEX IF NOT EXISTS idx_marcas_classe_vienna
  ON marcas USING GIN(classe_vienna);

-- Petições do processo (vêm do site do INPI via scraping autenticado)
CREATE TABLE IF NOT EXISTS peticoes (
  id              BIGSERIAL    PRIMARY KEY,
  numero_processo VARCHAR(20)  NOT NULL,
  protocolo       VARCHAR(30),
  data_peticao    DATE,
  servico         VARCHAR(10),
  cliente         TEXT,
  numero_img      VARCHAR(10),
  data_delivery   DATE,
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT peticoes_unique UNIQUE (numero_processo, protocolo)
);

CREATE INDEX IF NOT EXISTS idx_peticoes_processo ON peticoes(numero_processo);
