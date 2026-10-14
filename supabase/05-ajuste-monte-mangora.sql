-- =====================================================================
-- WL PEDIDOS - AJUSTE DO MONTE DO SEU JEITO (Mangora)
-- Use SO se o 04-loja-mangora.sql antigo ja foi executado.
-- Atualiza precos, descricao e tira os limites de quantidade.
-- =====================================================================
do $$
declare
  v_loja uuid;
  v_p bigint;
begin
  select id into v_loja from public.lojas where slug = 'mangora';
  if v_loja is null then
    raise notice 'Loja mangora nao encontrada. Rode o 04-loja-mangora.sql.';
    return;
  end if;
  select id into v_p from public.produtos where loja_id = v_loja and nome = 'Monte do Seu Jeito';
  if v_p is null then
    raise notice 'Produto Monte do Seu Jeito nao encontrado.';
    return;
  end if;

  update public.produtos
  set descricao = 'Copo de 500 ml montado por você. Escolha à vontade frutas, temperos e cremes: cada item soma ao valor do copo.'
  where id = v_p;
  update public.produto_tamanhos set preco = 5.00 where produto_id = v_p;
  update public.grupos_opcoes set maximo = null where produto_id = v_p;

  update public.opcoes o set preco = x.preco, ordem = x.ordem
  from public.grupos_opcoes g,
       (values ('Manga',10,1),('Abacaxi',10,2),('Melancia',10,3),('Uva',10,4),('Morango',15,5),('Kiwi',15,6),
               ('Leite condensado',5,1),('Mel',5,2),('Creme Ninho',7,3),('Iogurte natural',7,4),
               ('Creme de chocolate',7,5),('Creme de maracujá',7,6)) as x(nome, preco, ordem)
  where g.id = o.grupo_id and g.produto_id = v_p and o.nome = x.nome;

  update public.opcoes o set preco = 2
  from public.grupos_opcoes g
  where g.id = o.grupo_id and g.produto_id = v_p and g.nome = 'Temperos';

  raise notice 'Monte do Seu Jeito atualizado.';
end;
$$;

select o.nome, o.preco, g.nome as grupo, g.maximo
from public.opcoes o
join public.grupos_opcoes g on g.id = o.grupo_id
join public.produtos p on p.id = g.produto_id
join public.lojas l on l.id = p.loja_id
where l.slug = 'mangora' and p.nome = 'Monte do Seu Jeito'
order by g.ordem, o.ordem;
