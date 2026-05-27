-- Adiciona campo sobrestadores: processos que estão bloqueando este pedido por colisão de marca.
-- Formato JSONB: [{"processo": "936590980", "marca": "Oba! Oba Refrigerantes"}, ...]
ALTER TABLE marcas
  ADD COLUMN IF NOT EXISTS sobrestadores JSONB;

-- Índice GIN para buscar marcas sobrestadas ou localizar qual processo está sobrestando
CREATE INDEX IF NOT EXISTS idx_marcas_sobrestadores
  ON marcas USING GIN(sobrestadores)
  WHERE sobrestadores IS NOT NULL;

-- Nota: o campo despacho_complemento (migration 012) estava sendo lido como despacho.complemento
-- mas o XML moderno usa <texto-complementar>. O parser foi corrigido para ler ambos.
-- Não é necessária alteração de schema — a coluna já existe.
