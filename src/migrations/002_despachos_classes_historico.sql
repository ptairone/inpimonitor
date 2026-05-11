-- Descrições oficiais dos códigos de despacho do INPI
CREATE TABLE IF NOT EXISTS despacho_codigos (
  codigo    VARCHAR(20) PRIMARY KEY,
  descricao TEXT        NOT NULL,
  categoria VARCHAR(30) NOT NULL DEFAULT 'outros'
);

-- Descrições das classes da Classificação de Nice
CREATE TABLE IF NOT EXISTS classe_nice_descricoes (
  classe    VARCHAR(5) PRIMARY KEY,
  descricao TEXT       NOT NULL
);

-- Histórico completo de despachos por processo
CREATE TABLE IF NOT EXISTS historico_despachos (
  id              BIGSERIAL    PRIMARY KEY,
  numero_processo VARCHAR(20)  NOT NULL,
  despacho_codigo VARCHAR(20),
  despacho_texto  TEXT,
  numero_revista  INT          NOT NULL,
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT historico_despachos_processo_revista_unique
    UNIQUE (numero_processo, numero_revista)
);

CREATE INDEX IF NOT EXISTS idx_historico_numero_processo ON historico_despachos(numero_processo);
CREATE INDEX IF NOT EXISTS idx_historico_numero_revista  ON historico_despachos(numero_revista);
CREATE INDEX IF NOT EXISTS idx_historico_codigo          ON historico_despachos(despacho_codigo);

-- ──────────────────────────────────────────────────────────────────────────────
-- Seed: códigos de despacho (fonte: INPI / Lei 9.279/96)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO despacho_codigos (codigo, descricao, categoria) VALUES
  -- Depósito
  ('BLIND',  'Dados não disponíveis no período consultado',              'deposito'),
  ('151.1',  'Pedido de marca depositado',                               'deposito'),
  ('151.2',  'Pedido em exigência (aguardando complementação)',          'deposito'),
  ('152',    'Publicado para apresentação de oposição',                  'publicacao'),
  ('153',    'Oposição apresentada',                                     'publicacao'),
  ('154',    'Depositante notificado sobre oposição',                    'publicacao'),
  ('155',    'Manifestação à oposição apresentada',                      'publicacao'),
  -- Exame
  ('156',    'Deferido',                                                  'exame'),
  ('157',    'Indeferido — inciso I do art. 124 (LPI)',                  'exame'),
  ('158',    'Indeferido — inciso II do art. 124 (LPI)',                 'exame'),
  ('159',    'Indeferido',                                               'exame'),
  ('160',    'Sobrestado (aguardando decisão de processo anterior)',      'exame'),
  ('161',    'Arquivado (falta de resposta à exigência)',                'exame'),
  ('162',    'Arquivado definitivamente',                                 'exame'),
  -- Recursos
  ('165',    'Recurso interposto pelo depositante',                      'recurso'),
  ('166',    'Recurso não recebido',                                     'recurso'),
  ('167',    'Recurso recebido',                                         'recurso'),
  ('168',    'Recurso provido — pedido deferido',                        'recurso'),
  ('169',    'Recurso denegado — pedido mantido indeferido',             'recurso'),
  ('170',    'Recurso provido em parte',                                 'recurso'),
  -- Concessão / Registro
  ('171',    'Registro concedido',                                       'concessao'),
  ('172',    'Registro concedido com limitação de produto/serviço',      'concessao'),
  ('173',    'Certificado de Registro expedido',                         'concessao'),
  ('219',    'Concessão de registro — 2ª via do certificado',            'concessao'),
  -- Renovação
  ('174',    'Registro renovado',                                        'renovacao'),
  ('175',    'Renovação indeferida',                                     'renovacao'),
  ('176',    'Recurso de renovação provido',                             'renovacao'),
  ('177',    'Pedido de renovação em exame',                             'renovacao'),
  ('178',    'Prazo de sobrestamento de renovação',                      'renovacao'),
  -- Extinção / Caducidade
  ('200',    'Caducidade declarada (art. 143, LPI)',                     'extincao'),
  ('201',    'Caducidade não declarada',                                 'extincao'),
  ('202',    'Pedido de caducidade apresentado por terceiro',            'extincao'),
  ('203',    'Registro extinto por não renovação no prazo',              'extincao'),
  ('204',    'Extinção do registro — desistência do titular',            'extincao'),
  -- Nulidade administrativa
  ('220',    'Processo de nulidade administrativo instaurado',           'nulidade'),
  ('221',    'Nulidade declarada',                                       'nulidade'),
  ('222',    'Nulidade não declarada',                                   'nulidade'),
  ('223',    'Recurso de nulidade interposto',                           'nulidade'),
  -- Anotações
  ('190',    'Cessão de titularidade anotada',                           'anotacao'),
  ('191',    'Mudança de nome/razão social anotada',                     'anotacao'),
  ('192',    'Alteração de endereço anotada',                            'anotacao'),
  ('193',    'Licença de uso anotada',                                   'anotacao'),
  ('194',    'Cancelamento de licença anotada',                          'anotacao')
ON CONFLICT (codigo) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- Seed: classes Nice (11ª edição, em português)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO classe_nice_descricoes (classe, descricao) VALUES
  ('01', 'Produtos químicos para uso industrial, científico e fotográfico'),
  ('02', 'Tintas, vernizes, lacas; preservativos contra ferrugem e deterioração do madeiramento'),
  ('03', 'Preparações para branquear e outras substâncias para lavagem; preparações para limpar, polir e desengordurar'),
  ('04', 'Óleos e graxas industriais; lubrificantes; combustíveis e material de iluminação'),
  ('05', 'Produtos farmacêuticos, veterinários e higiênicos; substâncias dietéticas para uso médico'),
  ('06', 'Metais comuns e suas ligas; materiais metálicos de construção e edificação'),
  ('07', 'Máquinas, aparelhos mecânicos e seus componentes; motores (exceto para veículos terrestres)'),
  ('08', 'Ferramentas e instrumentos manuais; cutelaria; armas de fogo'),
  ('09', 'Aparelhos e instrumentos científicos, fotográficos, cinematográficos, óticos, de pesagem e de medição; software'),
  ('10', 'Aparelhos e instrumentos cirúrgicos, médicos, odontológicos e veterinários'),
  ('11', 'Aparelhos de iluminação, de aquecimento, de refrigeração, de cozimento, de ventilação e de distribuição de água'),
  ('12', 'Veículos; aparelhos de locomoção por terra, ar ou água'),
  ('13', 'Armas de fogo; munições e projéteis; explosivos; fogos de artifício'),
  ('14', 'Metais preciosos e suas ligas; joalheria, bijuteria, pedras preciosas; instrumentos de medição do tempo'),
  ('15', 'Instrumentos musicais'),
  ('16', 'Papel, papelão e artigos deles feitos; produtos de artes gráficas; materiais de escritório e papelaria'),
  ('17', 'Borracha, plásticos semiacabados e produtos deles feitos; materiais de calafetagem, vedação e isolamento'),
  ('18', 'Couro e imitações de couro; artigos de couro; malas e bolsas de viagem; guarda-chuvas e sombrinhas'),
  ('19', 'Materiais de construção não metálicos; asfalto, piche e betume; construções transportáveis não metálicas'),
  ('20', 'Móveis, espelhos, molduras; artigos de madeira, cortiça, junco, vime, bambu e materiais plásticos'),
  ('21', 'Utensílios e recipientes para uso doméstico ou de cozinha; artigos de vidro, porcelana e faiança; esponjas e escovas'),
  ('22', 'Cordas, fios, redes, tendas, toldos, lonas de vela; materiais de estofamento; matérias-primas fibrosas para têxteis'),
  ('23', 'Fios para uso têxtil'),
  ('24', 'Tecidos e sucedâneos de tecidos; roupas de cama e mesa'),
  ('25', 'Vestuário, calçados, chapelaria'),
  ('26', 'Rendas e bordados, fitas e laços; botões, colchetes, alfinetes e agulhas; flores artificiais; enfeites de cabelo'),
  ('27', 'Tapetes, capachos, esteiras, linóleos e outros revestimentos de piso; tapeçarias de parede não têxteis'),
  ('28', 'Jogos, brinquedos; artigos de ginástica e esporte; decorações para árvores de Natal'),
  ('29', 'Carne, peixe, aves e caça; frutas e legumes em conserva, congelados ou secos; laticínios; óleos e gorduras comestíveis'),
  ('30', 'Café, chá, cacau e sucedâneos; cereais e produtos de padaria; chocolates; temperos, especiarias e condimentos; sorvetes'),
  ('31', 'Produtos agrícolas, hortícolas, florestais e grãos; frutas e legumes frescos; plantas e flores naturais; alimentos para animais'),
  ('32', 'Cervejas; águas minerais e gasosas; bebidas não alcoólicas; sucos de frutas; xaropes para bebidas'),
  ('33', 'Bebidas alcoólicas (exceto cervejas)'),
  ('34', 'Tabaco; artigos para fumantes; cigarros eletrônicos; fósforos'),
  ('35', 'Publicidade; gestão de negócios comerciais; administração comercial; serviços de escritório'),
  ('36', 'Seguros; operações financeiras; operações monetárias; negócios imobiliários; serviços bancários'),
  ('37', 'Construção; reparação; serviços de instalação'),
  ('38', 'Telecomunicações; transmissão de dados; serviços de internet'),
  ('39', 'Transporte; embalagem e armazenagem de mercadorias; organização de viagens'),
  ('40', 'Tratamento de materiais; reciclagem de resíduos; purificação do ar e tratamento de água'),
  ('41', 'Educação; formação; entretenimento; atividades esportivas e culturais; publicação de livros e revistas'),
  ('42', 'Serviços científicos e tecnológicos; pesquisa e design; desenvolvimento de hardware e software; computação em nuvem'),
  ('43', 'Serviços de fornecimento de alimentos e bebidas; hospedagem temporária; restaurantes, bares e cafés'),
  ('44', 'Serviços médicos, veterinários e de saúde; cuidados de higiene e beleza para humanos e animais; agricultura e horticultura'),
  ('45', 'Serviços jurídicos; serviços de segurança para proteção de propriedade e indivíduos; serviços pessoais e sociais')
ON CONFLICT (classe) DO NOTHING;
