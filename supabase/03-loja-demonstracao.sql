-- =====================================================================
-- WL PEDIDOS - LOJA DE DEMONSTRACAO (opcional)
-- Cria a loja "demo" com cardapio de exemplo para mostrar aos clientes.
-- Link: cardapio.html?loja=demo
-- Pode apagar depois pelo SQL:  delete from public.lojas where slug = 'demo';
-- =====================================================================

do $$
declare
  v_loja uuid;
  c_acai bigint; c_lanche bigint; c_bebida bigint;
  v_p bigint; v_g bigint;
begin
  if exists (select 1 from public.lojas where slug = 'demo') then
    raise notice 'A loja demo ja existe. Nada foi feito.';
    return;
  end if;

  insert into public.lojas (slug, nome, cor_primaria, whatsapp, chave_pix, endereco,
                            taxa_entrega, pedido_minimo, aceita_delivery, aceita_retirada, aceita_mesa)
  values ('demo', 'Lanchonete Demonstração', '#7c3aed', '43999999999', 'pix@exemplo.com',
          'Rua Exemplo, 100 - Centro', 5, 15, true, true, true)
  returning id into v_loja;

  insert into public.categorias (loja_id, nome, ordem) values (v_loja, 'Açaí', 1) returning id into c_acai;
  insert into public.categorias (loja_id, nome, ordem) values (v_loja, 'Lanches', 2) returning id into c_lanche;
  insert into public.categorias (loja_id, nome, ordem) values (v_loja, 'Bebidas', 3) returning id into c_bebida;

  -- Acai monte do seu jeito (tamanhos + grupos)
  insert into public.produtos (loja_id, categoria_id, nome, descricao, ordem)
  values (v_loja, c_acai, 'Açaí Monte do Seu Jeito', 'Escolha o tamanho, até 3 frutas, complementos e a cobertura.', 1)
  returning id into v_p;
  insert into public.produto_tamanhos (produto_id, loja_id, nome, preco, ordem) values
    (v_p, v_loja, '300 ml', 14, 1), (v_p, v_loja, '500 ml', 18, 2), (v_p, v_loja, '700 ml', 24, 3);

  insert into public.grupos_opcoes (produto_id, loja_id, nome, minimo, maximo, ordem)
  values (v_p, v_loja, 'Frutas', 0, 3, 1) returning id into v_g;
  insert into public.opcoes (grupo_id, loja_id, nome, preco, ordem) values
    (v_g, v_loja, 'Morango', 0, 1), (v_g, v_loja, 'Banana', 0, 2), (v_g, v_loja, 'Kiwi', 2, 3);

  insert into public.grupos_opcoes (produto_id, loja_id, nome, minimo, maximo, ordem)
  values (v_p, v_loja, 'Complementos', 0, null, 2) returning id into v_g;
  insert into public.opcoes (grupo_id, loja_id, nome, preco, ordem) values
    (v_g, v_loja, 'Leite em pó', 2, 1), (v_g, v_loja, 'Granola', 2, 2), (v_g, v_loja, 'Paçoca', 2.5, 3);

  insert into public.grupos_opcoes (produto_id, loja_id, nome, minimo, maximo, ordem)
  values (v_p, v_loja, 'Cobertura', 1, 1, 3) returning id into v_g;
  insert into public.opcoes (grupo_id, loja_id, nome, preco, ordem) values
    (v_g, v_loja, 'Leite condensado', 0, 1), (v_g, v_loja, 'Mel', 0, 2), (v_g, v_loja, 'Creme de chocolate', 1.5, 3);

  -- Lanches
  insert into public.produtos (loja_id, categoria_id, nome, descricao, preco, ordem)
  values (v_loja, c_lanche, 'X-Burguer', 'Pão, hambúrguer artesanal 150 g, queijo e maionese da casa.', 22, 1)
  returning id into v_p;
  insert into public.grupos_opcoes (produto_id, loja_id, nome, minimo, maximo, ordem)
  values (v_p, v_loja, 'Adicionais', 0, null, 1) returning id into v_g;
  insert into public.opcoes (grupo_id, loja_id, nome, preco, ordem) values
    (v_g, v_loja, 'Bacon', 4, 1), (v_g, v_loja, 'Ovo', 2, 2), (v_g, v_loja, 'Cheddar', 3, 3);

  insert into public.produtos (loja_id, categoria_id, nome, descricao, preco, ordem)
  values (v_loja, c_lanche, 'X-Salada', 'Pão, hambúrguer 150 g, queijo, alface, tomate e maionese.', 24, 2);

  -- Bebidas
  insert into public.produtos (loja_id, categoria_id, nome, preco, ordem)
  values (v_loja, c_bebida, 'Refrigerante lata', 6, 1) returning id into v_p;
  insert into public.grupos_opcoes (produto_id, loja_id, nome, minimo, maximo, ordem)
  values (v_p, v_loja, 'Sabor', 1, 1, 1) returning id into v_g;
  insert into public.opcoes (grupo_id, loja_id, nome, preco, ordem) values
    (v_g, v_loja, 'Cola', 0, 1), (v_g, v_loja, 'Guaraná', 0, 2), (v_g, v_loja, 'Laranja', 0, 3);

  insert into public.produtos (loja_id, categoria_id, nome, descricao, ordem)
  values (v_loja, c_bebida, 'Suco natural', 'Feito na hora.', 2) returning id into v_p;
  insert into public.produto_tamanhos (produto_id, loja_id, nome, preco, ordem) values
    (v_p, v_loja, '300 ml', 8, 1), (v_p, v_loja, '500 ml', 11, 2);
  insert into public.grupos_opcoes (produto_id, loja_id, nome, minimo, maximo, ordem)
  values (v_p, v_loja, 'Sabor', 1, 1, 1) returning id into v_g;
  insert into public.opcoes (grupo_id, loja_id, nome, preco, ordem) values
    (v_g, v_loja, 'Laranja', 0, 1), (v_g, v_loja, 'Limão', 0, 2), (v_g, v_loja, 'Maracujá', 0, 3);

  raise notice 'Loja demo criada.';
end;
$$;
