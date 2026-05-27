-- Códigos de despacho encontrados no banco sem categoria mapeada

-- 180: Petição de nulidade administrativa (Art. 219 da LPI)
INSERT INTO despacho_codigos (codigo, descricao, categoria) VALUES
  ('180', 'Petição de nulidade administrativa (Art. 219 LPI)', 'nulidade'),
  ('910', 'Despacho administrativo diverso',                   'deposito')
ON CONFLICT (codigo) DO NOTHING;

-- Propaga categoria/descrição para marcas que tinham NULL
UPDATE marcas m
SET despacho_categoria = dc.categoria,
    despacho_descricao  = dc.descricao
FROM despacho_codigos dc
WHERE dc.codigo = m.despacho_codigo
  AND m.despacho_categoria IS NULL
  AND m.despacho_codigo IS NOT NULL;
