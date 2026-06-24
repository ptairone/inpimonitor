ALTER TABLE revistas_controle ADD COLUMN IF NOT EXISTS fonte VARCHAR(10);

-- Histórico anterior fica com fonte NULL (desconhecida) — só marcamos as 3 que
-- sabemos que foram corrigidas de PDF para XML em 23/06/2026.
UPDATE revistas_controle SET fonte = 'xml' WHERE numero_revista IN (2892, 2893, 2894);
