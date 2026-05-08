-- Tabela de controle das revistas baixadas e importadas
CREATE TABLE IF NOT EXISTS revistas_controle (
  numero_revista  INT PRIMARY KEY,
  baixado         BOOLEAN      DEFAULT FALSE,
  importado       BOOLEAN      DEFAULT FALSE,
  data_download   TIMESTAMPTZ,
  data_importacao TIMESTAMPTZ,
  total_registros INT          DEFAULT 0
);

-- Tabela principal de marcas
CREATE TABLE IF NOT EXISTS marcas (
  id               BIGSERIAL    PRIMARY KEY,
  numero_processo  VARCHAR(20)  NOT NULL,
  nome_marca       TEXT,
  titular          TEXT,
  pais             VARCHAR(5),
  uf               VARCHAR(5),
  classe_nice      TEXT[],
  status           TEXT,
  despacho_codigo  VARCHAR(20),
  data_deposito    DATE,
  data_concessao   DATE,
  data_vigencia    DATE,
  tipo_marca       VARCHAR(50),
  natureza         TEXT,
  procurador       TEXT,
  numero_revista   INT          NOT NULL,
  search_vector    TSVECTOR,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT marcas_numero_processo_unique UNIQUE (numero_processo)
);

-- Índice full-text (GIN é ideal para tsvector)
CREATE INDEX IF NOT EXISTS idx_marcas_search_vector
  ON marcas USING GIN(search_vector);

-- Índices para buscas diretas
CREATE INDEX IF NOT EXISTS idx_marcas_numero_processo  ON marcas(numero_processo);
CREATE INDEX IF NOT EXISTS idx_marcas_classe_nice      ON marcas USING GIN(classe_nice);
CREATE INDEX IF NOT EXISTS idx_marcas_status           ON marcas(status);
CREATE INDEX IF NOT EXISTS idx_marcas_numero_revista   ON marcas(numero_revista);
CREATE INDEX IF NOT EXISTS idx_marcas_nome_marca       ON marcas(nome_marca);
CREATE INDEX IF NOT EXISTS idx_marcas_titular          ON marcas(titular);

-- Função e trigger para manter search_vector atualizado automaticamente
CREATE OR REPLACE FUNCTION fn_atualizar_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector(
    'portuguese',
    coalesce(NEW.nome_marca, '') || ' ' || coalesce(NEW.titular, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_marcas_search_vector ON marcas;
CREATE TRIGGER tg_marcas_search_vector
  BEFORE INSERT OR UPDATE ON marcas
  FOR EACH ROW EXECUTE FUNCTION fn_atualizar_search_vector();

-- Função e trigger para manter updated_at atualizado
CREATE OR REPLACE FUNCTION fn_atualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_marcas_updated_at ON marcas;
CREATE TRIGGER tg_marcas_updated_at
  BEFORE UPDATE ON marcas
  FOR EACH ROW EXECUTE FUNCTION fn_atualizar_updated_at();
