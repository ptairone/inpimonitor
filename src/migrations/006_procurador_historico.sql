-- Adiciona procurador ao histórico de despachos para rastrear todos os
-- representantes que um processo já teve, não apenas o mais recente
ALTER TABLE historico_despachos ADD COLUMN IF NOT EXISTS procurador TEXT;

CREATE INDEX IF NOT EXISTS idx_historico_procurador
  ON historico_despachos(procurador)
  WHERE procurador IS NOT NULL;
