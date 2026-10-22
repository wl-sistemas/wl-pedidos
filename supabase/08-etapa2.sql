-- =====================================================================
-- WL PEDIDOS - 08: ETAPA 2
--   * Taxa de entrega por distancia (faixas de km) usando a localizacao
--     do cliente no mapa
--   * Horario automatico de abrir e fechar (com pausa "fechar agora")
--   * Historico e busca de pedidos de dias anteriores
-- Rode uma vez no SQL Editor do Supabase, DEPOIS do 07. Pode rodar de novo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. COLUNAS NOVAS
-- ---------------------------------------------------------------------
alter table public.lojas add column if not exists latitude           double precision;
alter table public.lojas add column if not exists longitude          double precision;
alter table public.lojas add column if not exists modo_taxa          text not null default 'fixa';
alter table public.lojas add column if not exists faixas_entrega     jsonb not null default '[]'::jsonb;
alter table public.lojas add column if not exists exigir_localizacao boolean not null default false;
alter table public.lojas add column if not exists horario_automatico boolean not null default false;
alter table public.lojas add column if not exists horarios           jsonb not null default '{}'::jsonb;
alter table public.lojas add column if not exists pausa_ate          timestamptz;

alter table public.lojas drop constraint if exists lojas_modo_taxa_check;
alter table public.lojas add constraint lojas_modo_taxa_check check (modo_taxa in ('fixa','distancia'));
alter table public.lojas drop constraint if exists lojas_local_check;
alter table public.lojas add constraint lojas_local_check check (
  (latitude is null and longitude is null) or
  (latitude between -90 and 90 and longitude between -180 and 180));
alter table public.lojas drop constraint if exists lojas_faixas_check;
alter table public.lojas add constraint lojas_faixas_check check (
  jsonb_typeof(faixas_entrega) = 'array' and jsonb_array_length(faixas_entrega) <= 12);
alter table public.lojas drop constraint if exists lojas_horarios_check;
alter table public.lojas add constraint lojas_horarios_check check (
  jsonb_typeof(horarios) = 'object' and length(horarios::text) <= 3000);

alter table public.pedidos add column if not exists distancia_km numeric(8,2);
alter table public.pedidos add column if not exists latitude     double precision;
alter table public.pedidos add column if not exists longitude    double precision;

-- A loja edita as novas configuracoes pelo painel (pausa so pela funcao)
grant update (nome, aberta, mensagem_fechada, logo_url, cor_primaria, whatsapp, chave_pix,
              endereco, taxa_entrega, pedido_minimo, aceita_delivery, aceita_retirada,
              aceita_mesa, formas_pagamento,
              latitude, longitude, modo_taxa, faixas_entrega, exigir_localizacao,
              horario_automatico, horarios)
  on public.lojas to authenticated;

create index if not exists idx_pedidos_loja_dataref on public.pedidos(loja_id, data_ref desc);

-- ---------------------------------------------------------------------
-- 2. DISTANCIA E TAXA
-- ---------------------------------------------------------------------
-- Distancia em linha reta (km) entre dois pontos (formula de haversine)
create or replace function public.distancia_km(lat1 double precision, lng1 double precision,
                                               lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = public as $$
  select 2 * 6371 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))));
$$;

-- Valor da faixa para a distancia; null = fora da area de entrega
create or replace function public.taxa_por_distancia(l public.lojas, p_km numeric)
returns numeric language sql stable set search_path = public as $$
  select (f->>'valor')::numeric
  from jsonb_array_elements(l.faixas_entrega) f
  where jsonb_typeof(f->'ate_km') = 'number' and jsonb_typeof(f->'valor') = 'number'
    and (f->>'valor')::numeric >= 0
    and p_km <= (f->>'ate_km')::numeric
  order by (f->>'ate_km')::numeric
  limit 1;
$$;

create or replace function public.raio_maximo(l public.lojas)
returns numeric language sql stable set search_path = public as $$
  select max((f->>'ate_km')::numeric)
  from jsonb_array_elements(l.faixas_entrega) f
  where jsonb_typeof(f->'ate_km') = 'number';
$$;

-- ---------------------------------------------------------------------
-- 3. HORARIO AUTOMATICO
--   horarios = {"0": [{"abre":"18:00","fecha":"23:00"}], ..., "6": [...]}
--   0 = domingo ... 6 = sabado. "fecha" menor que "abre" = vira a noite.
-- ---------------------------------------------------------------------
create or replace function public.agenda_loja(l public.lojas, p_agora timestamptz default now())
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_local  timestamp := p_agora at time zone l.fuso;
  v_ref    timestamp;
  v_dia    date;
  v_f      jsonb;
  v_ini    timestamp;
  v_fim    timestamp;
  v_dentro boolean := false;
  v_fecha  timestamp;
  v_abre   timestamp;
begin
  -- durante uma pausa, a proxima abertura conta a partir do fim da pausa
  v_ref := greatest(v_local, coalesce(l.pausa_ate at time zone l.fuso, v_local));
  for i in -1..8 loop
    v_dia := v_local::date + i;
    for v_f in select * from jsonb_array_elements(
                 case when jsonb_typeof(l.horarios -> extract(dow from v_dia)::int::text) = 'array'
                      then l.horarios -> extract(dow from v_dia)::int::text else '[]'::jsonb end)
    loop
      if coalesce(v_f->>'abre','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(v_f->>'fecha','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        continue;
      end if;
      v_ini := v_dia + (v_f->>'abre')::time;
      v_fim := v_dia + (v_f->>'fecha')::time;
      if v_fim <= v_ini then v_fim := v_fim + interval '1 day'; end if;
      if v_local >= v_ini and v_local < v_fim then
        v_dentro := true;
        v_fecha := greatest(coalesce(v_fecha, v_fim), v_fim);
      end if;
      if v_ini > v_ref and (v_abre is null or v_ini < v_abre) then
        v_abre := v_ini;
      end if;
    end loop;
  end loop;
  return jsonb_build_object(
    'dentro', v_dentro,
    'fecha_em', case when v_fecha is null then null else v_fecha at time zone l.fuso end,
    'abre_em', case when v_abre is null then null else v_abre at time zone l.fuso end);
end;
$$;

create or replace function public.loja_aberta_agora(l public.lojas)
returns boolean language sql stable set search_path = public as $$
  select case
    when not l.horario_automatico then l.aberta
    else coalesce((public.agenda_loja(l)->>'dentro')::boolean, false)
         and (l.pausa_ate is null or l.pausa_ate <= now())
  end;
$$;

-- Texto mostrado quando alguem tenta pedir com a loja fechada
create or replace function public.texto_loja_fechada(l public.lojas)
returns text language plpgsql stable set search_path = public as $$
declare
  v_abre  timestamptz;
  v_local timestamp;
  v_hoje  date := (now() at time zone l.fuso)::date;
  v_dia   text;
  v_nomes text[] := array['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
begin
  if nullif(trim(l.mensagem_fechada), '') is not null then
    return trim(l.mensagem_fechada);
  end if;
  if l.horario_automatico then
    v_abre := (public.agenda_loja(l)->>'abre_em')::timestamptz;
    if v_abre is not null then
      v_local := v_abre at time zone l.fuso;
      v_dia := case v_local::date - v_hoje
                 when 0 then 'hoje' when 1 then 'amanhã'
                 else v_nomes[extract(dow from v_local)::int + 1] end;
      return 'A loja está fechada agora. Abrimos ' || v_dia || ' às ' || to_char(v_local, 'HH24:MI') || '.';
    end if;
  end if;
  return 'A loja está fechada no momento.';
end;
$$;

-- Situacao da loja para o painel
create or replace function public.status_loja(p_loja uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  l public.lojas%rowtype;
  v_ag jsonb;
begin
  if not public.pode_gerenciar(p_loja) then
    raise exception 'Sem permissão para esta loja.';
  end if;
  select * into l from public.lojas where id = p_loja;
  v_ag := public.agenda_loja(l);
  return jsonb_build_object(
    'aberta', public.loja_aberta_agora(l),
    'automatico', l.horario_automatico,
    'dentro_do_horario', v_ag->'dentro',
    'pausada', l.horario_automatico and l.pausa_ate is not null and l.pausa_ate > now(),
    'fecha_em', v_ag->'fecha_em', 'abre_em', v_ag->'abre_em');
end;
$$;

-- "Fechar agora" no modo automatico: fecha ate o fim do horario atual
-- (volta a abrir sozinha no proximo horario). p_pausar=false reabre.
create or replace function public.pausar_loja(p_loja uuid, p_pausar boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  l public.lojas%rowtype;
  v_fim timestamptz;
begin
  if not public.pode_gerenciar(p_loja) then
    raise exception 'Sem permissão para esta loja.';
  end if;
  select * into l from public.lojas where id = p_loja;
  if p_pausar then
    l.pausa_ate := null;
    v_fim := (public.agenda_loja(l)->>'fecha_em')::timestamptz;
    update public.lojas set pausa_ate = coalesce(v_fim, now() + interval '12 hours') where id = p_loja;
  else
    update public.lojas set pausa_ate = null where id = p_loja;
  end if;
  return public.status_loja(p_loja);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. HISTORICO DE PEDIDOS (respeita as permissoes de quem consulta)
--   p_busca: nome, telefone ou numero do pedido
-- ---------------------------------------------------------------------
create or replace function public.historico_pedidos(p_loja uuid, p_de date, p_ate date, p_busca text default null)
returns setof public.pedidos language sql stable security invoker set search_path = public as $$
  select p.* from public.pedidos p
  where p.loja_id = p_loja
    and p.data_ref between coalesce(p_de, p_ate, current_date) and coalesce(p_ate, p_de, current_date)
    and (
      nullif(trim(coalesce(p_busca,'')), '') is null
      or p.cliente_nome ilike '%' || trim(p_busca) || '%'
      or (length(regexp_replace(p_busca, '\D', '', 'g')) >= 3
          and p.telefone like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%')
      or trim(p_busca) ~ '^#?[0-9]{1,5}$' and p.numero = ltrim(trim(p_busca), '#')::int
    )
  order by p.criado_em desc
  limit 300;
$$;

-- ---------------------------------------------------------------------
-- 5. FUNCOES ATUALIZADAS (cardapio publico e criacao de pedido)
-- ---------------------------------------------------------------------
create or replace function public.cardapio_publico(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  l public.lojas%rowtype;
begin
  select * into l from public.lojas where slug = lower(trim(p_slug));
  if not found then
    return null;
  end if;

  if not l.ativa then
    return jsonb_build_object('loja', jsonb_build_object(
      'slug', l.slug, 'nome', l.nome, 'ativa', false,
      'logo_url', l.logo_url, 'cor_primaria', l.cor_primaria),
      'categorias', '[]'::jsonb, 'produtos', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'loja', jsonb_build_object(
      'slug', l.slug, 'nome', l.nome, 'ativa', true, 'aberta', public.loja_aberta_agora(l), 'fuso', l.fuso,
      'horario_automatico', l.horario_automatico, 'horarios', l.horarios,
      'abre_em', (public.agenda_loja(l))->'abre_em', 'fecha_em', (public.agenda_loja(l))->'fecha_em',
      'modo_taxa', l.modo_taxa, 'faixas_entrega', l.faixas_entrega,
      'exigir_localizacao', l.exigir_localizacao, 'latitude', l.latitude, 'longitude', l.longitude,
      'mensagem_fechada', l.mensagem_fechada, 'logo_url', l.logo_url,
      'cor_primaria', l.cor_primaria, 'whatsapp', l.whatsapp, 'chave_pix', l.chave_pix,
      'endereco', l.endereco, 'taxa_entrega', l.taxa_entrega, 'pedido_minimo', l.pedido_minimo,
      'aceita_delivery', l.aceita_delivery, 'aceita_retirada', l.aceita_retirada,
      'aceita_mesa', l.aceita_mesa, 'formas_pagamento', to_jsonb(l.formas_pagamento)),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) order by c.ordem, c.id)
      from public.categorias c
      where c.loja_id = l.id and c.ativa), '[]'::jsonb),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoria_id', p.categoria_id, 'nome', p.nome, 'descricao', p.descricao,
        'imagem_url', p.imagem_url, 'preco', p.preco, 'disponivel', p.disponivel,
        'tamanhos', coalesce((
          select jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome, 'preco', t.preco)
                           order by t.ordem, t.id)
          from public.produto_tamanhos t where t.produto_id = p.id), '[]'::jsonb),
        'grupos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', g.id, 'nome', g.nome, 'minimo', g.minimo, 'maximo', g.maximo,
            'opcoes', coalesce((
              select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome, 'preco', o.preco,
                                                  'disponivel', o.disponivel)
                               order by o.ordem, o.id)
              from public.opcoes o where o.grupo_id = g.id), '[]'::jsonb))
            order by g.ordem, g.id)
          from public.grupos_opcoes g where g.produto_id = p.id), '[]'::jsonb))
        order by p.ordem, p.id)
      from public.produtos p
      left join public.categorias c on c.id = p.categoria_id
      where p.loja_id = l.id and p.ativo and (c.id is null or c.ativa)), '[]'::jsonb)
  );
end;
$$;

create or replace function public.criar_pedido(p_slug text, p_pedido jsonb, p_itens jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  l          public.lojas%rowtype;
  v_manual   boolean;
  v_nome     text;
  v_tel      text;
  v_tipo     text;
  v_endereco text;
  v_mesa     text;
  v_pag      text;
  v_troco    numeric(10,2);
  v_obs      text;
  v_item     jsonb;
  v_prod     public.produtos%rowtype;
  v_tam_nome text;
  v_base     numeric(10,2);
  v_ids      bigint[];
  v_qtd_ok   integer;
  v_extra    numeric(10,2);
  v_snap     jsonb;
  v_grupo    record;
  v_qtd      integer;
  v_unit     numeric(10,2);
  v_itens    jsonb := '[]'::jsonb;
  v_subtotal numeric(10,2) := 0;
  v_taxa     numeric(10,2) := 0;
  v_total    numeric(10,2);
  v_data     date;
  v_numero   integer;
  v_id       bigint;
  v_token    uuid;
  v_lat      double precision;
  v_lng      double precision;
  v_dist     numeric(8,2);
begin
  select * into l from public.lojas where slug = lower(trim(coalesce(p_slug,'')));
  if not found or not l.ativa then
    raise exception 'Esta loja não está disponível no momento.';
  end if;

  v_manual := coalesce(p_pedido->>'origem','') = 'Manual' and public.pode_gerenciar(l.id);

  if not v_manual and not public.loja_aberta_agora(l) then
    raise exception '%', public.texto_loja_fechada(l);
  end if;

  v_nome := left(trim(coalesce(p_pedido->>'cliente_nome','')), 80);
  v_tel  := left(regexp_replace(coalesce(p_pedido->>'telefone',''), '\D', '', 'g'), 15);
  v_tipo := coalesce(p_pedido->>'tipo_atendimento','');
  v_endereco := nullif(left(trim(coalesce(p_pedido->>'endereco','')), 200), '');
  v_mesa := nullif(left(trim(coalesce(p_pedido->>'mesa','')), 20), '');
  v_pag  := nullif(trim(coalesce(p_pedido->>'pagamento','')), '');
  v_obs  := nullif(left(trim(coalesce(p_pedido->>'observacao','')), 300), '');

  if v_nome = '' then
    raise exception 'Informe seu nome.';
  end if;
  if not v_manual and length(v_tel) < 10 then
    raise exception 'Informe um WhatsApp válido com DDD.';
  end if;

  if v_tipo not in ('Delivery','Retirada','Mesa') then
    raise exception 'Escolha como deseja receber o pedido.';
  end if;
  if not v_manual and (
       (v_tipo = 'Delivery' and not l.aceita_delivery) or
       (v_tipo = 'Retirada' and not l.aceita_retirada) or
       (v_tipo = 'Mesa'     and not l.aceita_mesa)) then
    raise exception 'Esta loja não aceita pedidos do tipo %.', v_tipo;
  end if;
  if v_tipo = 'Delivery' and coalesce(length(v_endereco),0) < 5 then
    raise exception 'Informe o endereço de entrega.';
  end if;
  if v_tipo = 'Mesa' and v_mesa is null then
    raise exception 'Informe o número da mesa ou comanda.';
  end if;
  if v_tipo <> 'Delivery' then v_endereco := null; end if;
  if v_tipo <> 'Mesa' then v_mesa := null; end if;

  if cardinality(l.formas_pagamento) > 0 and (v_pag is null or not (v_pag = any(l.formas_pagamento))) then
    raise exception 'Escolha uma forma de pagamento.';
  end if;
  if v_pag = 'Dinheiro' and nullif(p_pedido->>'troco_para','') is not null then
    begin
      v_troco := (p_pedido->>'troco_para')::numeric;
    exception when others then
      v_troco := null;
    end;
    if v_troco is not null and v_troco <= 0 then v_troco := null; end if;
  end if;

  -- Protecao simples contra envio repetido / abuso
  if not v_manual and (
    select count(*) from public.pedidos
    where loja_id = l.id and telefone = v_tel and criado_em > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'Muitos pedidos seguidos. Aguarde alguns minutos ou fale com a loja.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Seu carrinho está vazio.';
  end if;
  if jsonb_array_length(p_itens) > 50 then
    raise exception 'Pedido com itens demais.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    -- Produto
    begin
      select * into v_prod from public.produtos
      where id = (v_item->>'produto_id')::bigint and loja_id = l.id and ativo;
    exception when others then
      v_prod := null;
    end;
    if v_prod.id is null then
      raise exception 'Um item do carrinho não está mais no cardápio. Atualize a página.';
    end if;
    if not v_prod.disponivel then
      raise exception '"%" está esgotado no momento.', v_prod.nome;
    end if;

    -- Tamanho / preco base
    v_tam_nome := null;
    if exists (select 1 from public.produto_tamanhos where produto_id = v_prod.id) then
      select t.nome, t.preco into v_tam_nome, v_base
      from public.produto_tamanhos t
      where t.produto_id = v_prod.id
        and t.id::text = coalesce(v_item->>'tamanho_id','');
      if v_tam_nome is null then
        raise exception 'Escolha o tamanho de "%".', v_prod.nome;
      end if;
    else
      v_base := v_prod.preco;
      if v_base is null then
        raise exception '"%" está sem preço cadastrado.', v_prod.nome;
      end if;
    end if;

    -- Opcoes escolhidas
    begin
      select coalesce(array_agg(distinct x::bigint), '{}')
      into v_ids
      from jsonb_array_elements_text(coalesce(v_item->'opcoes','[]'::jsonb)) x;
    exception when others then
      raise exception 'Opções inválidas em "%".', v_prod.nome;
    end;

    select count(*), coalesce(sum(o.preco),0)
    into v_qtd_ok, v_extra
    from public.opcoes o
    join public.grupos_opcoes g on g.id = o.grupo_id
    where o.id = any(v_ids) and g.produto_id = v_prod.id;

    if v_qtd_ok <> cardinality(v_ids) then
      raise exception 'Opções inválidas em "%". Atualize a página.', v_prod.nome;
    end if;

    if exists (select 1 from public.opcoes o where o.id = any(v_ids) and not o.disponivel) then
      raise exception 'Um adicional escolhido em "%" acabou. Escolha outro.', v_prod.nome;
    end if;

    for v_grupo in
      select g.nome, g.minimo, g.maximo,
             (select count(*) from public.opcoes o where o.grupo_id = g.id and o.id = any(v_ids)) as qtd
      from public.grupos_opcoes g where g.produto_id = v_prod.id
    loop
      if v_grupo.qtd < v_grupo.minimo then
        raise exception 'Escolha pelo menos % em "%" (%).', v_grupo.minimo, v_grupo.nome, v_prod.nome;
      end if;
      if v_grupo.maximo is not null and v_grupo.qtd > v_grupo.maximo then
        raise exception 'Escolha no máximo % em "%" (%).', v_grupo.maximo, v_grupo.nome, v_prod.nome;
      end if;
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object('grupo', g.nome, 'nome', o.nome, 'preco', o.preco)
                              order by g.ordem, g.id, o.ordem, o.id), '[]'::jsonb)
    into v_snap
    from public.opcoes o join public.grupos_opcoes g on g.id = o.grupo_id
    where o.id = any(v_ids);

    -- Quantidade
    begin
      v_qtd := coalesce((v_item->>'quantidade')::integer, 1);
    exception when others then
      v_qtd := 0;
    end;
    if v_qtd < 1 or v_qtd > 99 then
      raise exception 'Quantidade inválida em "%".', v_prod.nome;
    end if;

    v_unit := v_base + v_extra;
    if v_unit <= 0 then
      raise exception '"%" está sem preço válido.', v_prod.nome;
    end if;

    v_subtotal := v_subtotal + v_unit * v_qtd;
    v_itens := v_itens || jsonb_build_object(
      'produto_id', v_prod.id, 'nome', v_prod.nome, 'tamanho', v_tam_nome,
      'opcoes', v_snap,
      'observacao', nullif(left(trim(coalesce(v_item->>'observacao','')), 200), ''),
      'preco_unitario', v_unit, 'quantidade', v_qtd, 'total', v_unit * v_qtd);
  end loop;

  -- Taxa de entrega: fixa ou por distancia (calculada aqui, nunca confiando no navegador)
  if v_tipo = 'Delivery' then
    v_taxa := l.taxa_entrega;
    begin
      v_lat := (p_pedido->>'latitude')::double precision;
      v_lng := (p_pedido->>'longitude')::double precision;
    exception when others then
      v_lat := null; v_lng := null;
    end;
    if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      v_lat := null; v_lng := null;
    end if;
    if l.latitude is not null and v_lat is not null then
      v_dist := round(public.distancia_km(l.latitude, l.longitude, v_lat, v_lng)::numeric, 2);
    end if;

    if l.modo_taxa = 'distancia' and l.latitude is not null
       and jsonb_array_length(l.faixas_entrega) > 0 then
      if v_dist is null then
        if l.exigir_localizacao and not v_manual then
          raise exception 'Marque no mapa o local de entrega para calcular a taxa.';
        end if;
      else
        v_taxa := public.taxa_por_distancia(l, v_dist);
        if v_taxa is null then
          if not v_manual then
            raise exception 'Este endereço fica a % km da loja, fora da área de entrega (até % km).',
              replace(round(v_dist, 1)::text, '.', ','),
              replace(public.raio_maximo(l)::text, '.', ',');
          end if;
          -- no balcao a loja decide: usa a maior faixa
          select max((f->>'valor')::numeric) into v_taxa
          from jsonb_array_elements(l.faixas_entrega) f where jsonb_typeof(f->'valor') = 'number';
        end if;
      end if;
    end if;
  end if;
  if not v_manual and v_subtotal < l.pedido_minimo then
    raise exception 'O pedido mínimo desta loja é %.', public.formatar_reais(l.pedido_minimo);
  end if;
  v_total := v_subtotal + v_taxa;

  -- Numero curto diario (#1, #2...) por loja, no fuso da loja
  v_data := (now() at time zone l.fuso)::date;
  insert into public.contador_pedidos as c (loja_id, data, ultimo)
  values (l.id, v_data, 1)
  on conflict (loja_id, data) do update set ultimo = c.ultimo + 1
  returning ultimo into v_numero;

  insert into public.pedidos (
    loja_id, numero, data_ref, cliente_nome, telefone, tipo_atendimento, endereco, mesa,
    pagamento, troco_para, observacao, subtotal, taxa_entrega, total, origem,
    distancia_km, latitude, longitude)
  values (
    l.id, v_numero, v_data, v_nome, nullif(v_tel,''), v_tipo, v_endereco, v_mesa,
    v_pag, v_troco, v_obs, v_subtotal, v_taxa, v_total,
    case when v_manual then 'Manual' else 'Cliente' end,
    v_dist, v_lat, v_lng)
  returning id, tracking_token into v_id, v_token;

  insert into public.itens_pedido (
    pedido_id, loja_id, produto_id, nome, tamanho, opcoes, observacao,
    preco_unitario, quantidade, total)
  select v_id, l.id, (i->>'produto_id')::bigint, i->>'nome', i->>'tamanho', i->'opcoes',
         i->>'observacao', (i->>'preco_unitario')::numeric, (i->>'quantidade')::integer,
         (i->>'total')::numeric
  from jsonb_array_elements(v_itens) i;

  return jsonb_build_object(
    'numero', v_numero, 'tracking_token', v_token,
    'subtotal', v_subtotal, 'taxa_entrega', v_taxa, 'total', v_total, 'distancia_km', v_dist);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. PERMISSOES DAS FUNCOES
-- ---------------------------------------------------------------------
revoke all on function public.distancia_km(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.taxa_por_distancia(public.lojas, numeric) from public, anon, authenticated;
revoke all on function public.raio_maximo(public.lojas)               from public, anon, authenticated;
revoke all on function public.agenda_loja(public.lojas, timestamptz)  from public, anon, authenticated;
revoke all on function public.loja_aberta_agora(public.lojas)         from public, anon, authenticated;
revoke all on function public.texto_loja_fechada(public.lojas)        from public, anon, authenticated;
revoke all on function public.status_loja(uuid)                       from public, anon, authenticated;
revoke all on function public.pausar_loja(uuid, boolean)              from public, anon, authenticated;
revoke all on function public.historico_pedidos(uuid, date, date, text) from public, anon, authenticated;
revoke all on function public.cardapio_publico(text)                  from public, anon, authenticated;
revoke all on function public.criar_pedido(text, jsonb, jsonb)        from public, anon, authenticated;

grant execute on function public.cardapio_publico(text)           to anon, authenticated;
grant execute on function public.criar_pedido(text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.status_loja(uuid)                to authenticated;
grant execute on function public.pausar_loja(uuid, boolean)       to authenticated;
grant execute on function public.historico_pedidos(uuid, date, date, text) to authenticated;

notify pgrst, 'reload schema';
