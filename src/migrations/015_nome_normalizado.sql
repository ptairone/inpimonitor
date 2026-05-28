-- Busca por nome normalizado: remove espaços, acentos, hífens, pontos
-- Permite encontrar "Win contábil" buscando "wincont", igual ao sistema do INPI

-- unaccent ja instalada (migration 003 via pg_trgm setup)
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS nome_normalizado TEXT;

-- Função de normalização: lowercase + unaccent + remove separadores
CREATE OR REPLACE FUNCTION fn_normalizar_nome_marca(nome TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(nome, ''))), '[\s\-\.\,\/\(\)&'']+', '', 'g')
$$;

-- Trigger para manter nome_normalizado atualizado automaticamente
CREATE OR REPLACE FUNCTION fn_tg_nome_normalizado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.nome_normalizado := fn_normalizar_nome_marca(NEW.nome_marca);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_marcas_nome_normalizado ON marcas;
CREATE TRIGGER tg_marcas_nome_normalizado
  BEFORE INSERT OR UPDATE OF nome_marca ON marcas
  FOR EACH ROW EXECUTE FUNCTION fn_tg_nome_normalizado();

-- Backfill de todos os registros existentes
UPDATE marcas SET nome_normalizado = fn_normalizar_nome_marca(nome_marca);

-- Índice GIN trigram para busca rápida por substring (ILIKE '%...%')
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marcas_nome_normalizado_gin
  ON marcas USING GIN(nome_normalizado gin_trgm_ops);
