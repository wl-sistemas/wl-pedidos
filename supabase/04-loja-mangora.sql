-- =====================================================================
-- WL PEDIDOS - LOJA MANGORA (primeira loja real)
-- Cria a loja "mangora" com os 14 sabores, o Monte do Seu Jeito,
-- fotos, logo e cor da marca. Nao mexe no sistema antigo da Mangora.
--
-- Antes: envie a pasta img/lojas/mangora para o GitHub (repositorio wl-pedidos).
-- Execute UMA vez no SQL Editor. Se a loja ja existir, nada e feito.
-- Link: cardapio.html?loja=mangora
-- =====================================================================

do $$
declare
  img text := 'https://wl-sistemas.github.io/wl-pedidos/img/lojas/mangora/';
  v_loja uuid;
  c_lanc bigint; c_carte bigint; c_monte bigint;
  v_p bigint; v_g bigint;
  r record;
  ordem integer := 0;
begin
  if exists (select 1 from public.lojas where slug = 'mangora') then
    raise notice 'A loja mangora ja existe. Nada foi feito.';
    return;
  end if;

  insert into public.lojas (slug, nome, cor_primaria, logo_url, whatsapp, chave_pix,
                            taxa_entrega, pedido_minimo, aceita_delivery, aceita_retirada, aceita_mesa,
                            formas_pagamento, aberta)
  values ('mangora', 'Mangora Frutas Temperadas', '#155b2a', img || 'logo.webp',
          '43999649635', '43999649635', 5, 0, true, true, true,
          array['Pix','Dinheiro','Cartão'], true)
  returning id into v_loja;

  insert into public.categorias (loja_id, nome, ordem) values (v_loja, 'Lançamentos', 1) returning id into c_lanc;
  insert into public.categorias (loja_id, nome, ordem) values (v_loja, 'À la Carte', 2) returning id into c_carte;
  insert into public.categorias (loja_id, nome, ordem) values (v_loja, 'Monte do Seu Jeito', 3) returning id into c_monte;

  -- Sabores: (arquivo da foto, nome, descricao, preco 400 ml, preco 500 ml, lancamento)
  for r in
    select * from (values
      ('classico', 'Mangora Clássico',   'Manga, limão e sal rosa.', 17.00, 22.00, false),
      ('mexicano', 'Mangora Mexicano',   'Manga, abacaxi, Chamoy e Tajín.', 18.00, 23.00, false),
      ('fresh',    'Mangora Fresh',      'Manga, abacaxi, sal rosa, limão e Lemon Pepper.', 18.00, 23.00, false),
      ('picante',  'Mangora Picante',    'Manga, abacaxi, limão, pimenta em pó, sal rosa e páprica picante.', 18.00, 22.00, false),
      ('tropical', 'Mangora Tropical',   'Kiwi, morango, abacaxi, limão, mel e sal.', 23.00, 27.00, false),
      ('tentacao', 'Mangora Tentação',   'Morango, creme Ninho e creme de chocolate.', 25.00, 30.00, false),
      ('deuses',   'Mangora dos Deuses', 'Manga, morango, kiwi, creme Ninho e creme de chocolate.', 26.00, 31.00, false),
      ('fit',      'Mangora Fit',        'Morango, kiwi, manga, iogurte natural e mel.', 26.00, 31.00, false),
      ('paixao',   'Mangora Paixão',     'Morango, kiwi, manga e creme de maracujá.', 26.00, 31.00, false),
      ('paraiso',  'Mangora Paraíso',    'Manga, melancia e abacaxi.', 15.90, 20.90, true),
      ('brasa',    'Mangora Brasa',      'Abacaxi, Lemon Pepper, limão, sal e pimenta preta.', 16.90, 21.90, true),
      ('rubi',     'Mangora Rubi',       'Melancia, Tajín, limão e pimenta.', 16.90, 21.90, true),
      ('explosao', 'Mangora Explosão',   'Manga, abacaxi, melancia, sal, Lemon Pepper, páprica doce, limão, pimenta e leite condensado.', 19.90, 24.90, true),
      ('ousadia',  'Mangora Ousadia',    'Abacaxi, kiwi, morango, uva, Lemon Pepper, limão, sal, páprica picante e leite condensado.', 25.90, 31.90, true)
    ) as t(arquivo, nome, descricao, p400, p500, lancamento)
  loop
    ordem := ordem + 1;
    insert into public.produtos (loja_id, categoria_id, nome, descricao, imagem_url, ordem)
    values (v_loja, case when r.lancamento then c_lanc else c_carte end, r.nome, r.descricao,
            img || r.arquivo || '.webp', ordem)
    returning id into v_p;
    insert into public.produto_tamanhos (produto_id, loja_id, nome, preco, ordem) values
      (v_p, v_loja, '400 ml', r.p400, 1),
      (v_p, v_loja, '500 ml', r.p500, 2);
  end loop;

  -- Monte do Seu Jeito: copo de 500 ml (R$ 5 de embalagem) + qualquer quantidade de itens
  insert into public.produtos (loja_id, categoria_id, nome, descricao, imagem_url, ordem)
  values (v_loja, c_monte, 'Monte do Seu Jeito',
          'Copo de 500 ml montado por você. Escolha à vontade frutas, temperos e cremes: cada item soma ao valor do copo.',
          img || 'monte-seu-jeito.webp', 1)
  returning id into v_p;
  insert into public.produto_tamanhos (produto_id, loja_id, nome, preco, ordem)
  values (v_p, v_loja, '500 ml', 5.00, 1);

  insert into public.grupos_opcoes (produto_id, loja_id, nome, minimo, maximo, ordem)
  values (v_p, v_loja, 'Frutas', 1, null, 1) returning id into v_g;
  insert into public.opcoes (grupo_id, loja_id, nome, preco, ordem) values
    (v_g, v_loja, 'Manga', 10, 1), (v_g, v_loja, 'Abacaxi', 10, 2), (v_g, v_loja, 'Melancia', 10, 3),
    (v_g, v_loja, 'Uva', 10, 4), (v_g, v_loja, 'Morango', 15, 5), (v_g, v_loja, 'Kiwi', 15, 6);

  insert into public.grupos_opcoes (produto_id, loja_id, nome, minimo, maximo, ordem)
  values (v_p, v_loja, 'Temperos', 0, null, 2) returning id into v_g;
  insert into public.opcoes (grupo_id, loja_id, nome, preco, ordem) values
    (v_g, v_loja, 'Chamoy', 2, 1), (v_g, v_loja, 'Tajín', 2, 2), (v_g, v_loja, 'Limão', 2, 3),
    (v_g, v_loja, 'Pimenta em pó', 2, 4), (v_g, v_loja, 'Sal rosa', 2, 5), (v_g, v_loja, 'Lemon Pepper', 2, 6),
    (v_g, v_loja, 'Páprica doce', 2, 7), (v_g, v_loja, 'Páprica picante', 2, 8);

  insert into public.grupos_opcoes (produto_id, loja_id, nome, minimo, maximo, ordem)
  values (v_p, v_loja, 'Caldas e cremes', 0, null, 3) returning id into v_g;
  insert into public.opcoes (grupo_id, loja_id, nome, preco, ordem) values
    (v_g, v_loja, 'Leite condensado', 5, 1), (v_g, v_loja, 'Mel', 5, 2), (v_g, v_loja, 'Creme Ninho', 7, 3),
    (v_g, v_loja, 'Iogurte natural', 7, 4), (v_g, v_loja, 'Creme de chocolate', 7, 5),
    (v_g, v_loja, 'Creme de maracujá', 7, 6);

  raise notice 'Loja Mangora criada.';
end;
$$;
