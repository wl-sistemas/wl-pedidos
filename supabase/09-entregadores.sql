-- =====================================================================
-- WL PEDIDOS - 09: ENTREGADORES (NIVEL 1)
--   * Cadastro de entregadores por loja
--   * Despachar pedido para um entregador (valor do entregador editavel)
--   * Pagina do entregador pelo link (sem login): Saí para entrega / Entreguei
--   * Codigo de entrega opcional (o cliente informa ao entregador)
--   * Base para o acerto do dia por entregador
-- Rode uma vez no SQL Editor do Supabase, DEPOIS do 08. Pode rodar de novo.
-- =====================================================================

alter table public.lojas add column if not exists codigo_entrega boolean not null default false;
grant update (codigo_entrega) on public.lojas to authenticated;

-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------
create table if not exists public.entregadores (
  id            bigint generated always as identity primary key,
  loja_id       uuid not null references public.lojas(id) on delete cascade,
  nome          text not null check (length(trim(nome)) between 2 and 60),
  whatsapp      text check (length(whatsapp) <= 20),
  valor_padrao  numeric(10,2) check (valor_padrao is null or valor_padrao >= 0), -- null = igual a taxa do pedido
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);
create index if not exists idx_entregadores_loja on public.entregadores(loja_id);

create table if not exists public.entregas (
  id                  bigint generated always as identity primary key,
  loja_id             uuid not null references public.lojas(id) on delete cascade,
  pedido_id           bigint not null references public.pedidos(id) on delete cascade,
  entregador_id       bigint references public.entregadores(id) on delete set null,
  entregador_nome     text not null,
  entregador_whatsapp text,
  token               uuid not null unique default gen_random_uuid(),
  status              text not null default 'Enviada'
                      check (status in ('Enviada','A caminho','Entregue','Cancelada')),
  valor_entregador    numeric(10,2) not null default 0 check (valor_entregador >= 0), -- quanto a loja paga ao entregador
  taxa_cliente        numeric(10,2) not null default 0,  -- taxa que o cliente pagou
  cobrar              numeric(10,2) not null default 0,  -- quanto o entregador cobra do cliente (0 = ja pago)
  forma_pagamento     text,
  recebido            numeric(10,2) not null default 0,  -- quanto o entregador recebeu do cliente
  codigo              text,
  tentativas          integer not null default 0,
  data_ref            date not null,
  criado_em           timestamptz not null default now(),
  saiu_em             timestamptz,
  entregue_em         timestamptz,
  acertado_em         timestamptz                          -- quando a loja acertou com o entregador
);
create index if not exists idx_entregas_loja_data on public.entregas(loja_id, data_ref desc);
create index if not exists idx_entregas_pedido on public.entregas(pedido_id);
-- no maximo uma entrega ativa por pedido
create unique index if not exists uq_entregas_pedido_ativa on public.entregas(pedido_id) where status <> 'Cancelada';

alter table public.entregadores enable row level security;
alter table public.entregas     enable row level security;
revoke all on public.entregadores, public.entregas from anon, authenticated;

grant select, insert, delete on public.entregadores to authenticated;
grant update (nome, whatsapp, valor_padrao, ativo) on public.entregadores to authenticated;
drop policy if exists "entregadores_all" on public.entregadores;
create policy "entregadores_all" on public.entregadores for all to authenticated
  using (public.pode_gerenciar(loja_id)) with check (public.pode_gerenciar(loja_id));

-- Entregas: criadas so pela funcao despachar_pedido. A loja le, cancela,
-- ajusta o valor do entregador e marca o acerto.
grant select on public.entregas to authenticated;
grant update (status, valor_entregador, acertado_em) on public.entregas to authenticated;
drop policy if exists "entregas_select" on public.entregas;
create policy "entregas_select" on public.entregas for select to authenticated
  using (public.pode_gerenciar(loja_id));
drop policy if exists "entregas_update" on public.entregas;
create policy "entregas_update" on public.entregas for update to authenticated
  using (public.pode_gerenciar(loja_id)) with check (public.pode_gerenciar(loja_id) and status in ('Cancelada','Enviada','A caminho','Entregue'));

-- ---------------------------------------------------------------------
-- 2. DESPACHAR (painel da loja)
-- ---------------------------------------------------------------------
create or replace function public.despachar_pedido(p_pedido bigint, p_entregador bigint, p_valor numeric default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p  public.pedidos%rowtype;
  en public.entregadores%rowtype;
  l  public.lojas%rowtype;
  v_valor numeric(10,2);
  v_token uuid;
  v_codigo text;
begin
  select * into p from public.pedidos where id = p_pedido;
  if not found or not public.pode_gerenciar(p.loja_id) then
    raise exception 'Pedido não encontrado.';
  end if;
  if p.tipo_atendimento <> 'Delivery' then
    raise exception 'Só pedidos de entrega podem ser despachados.';
  end if;
  if p.status in ('Finalizado','Cancelado') then
    raise exception 'Este pedido já foi %.', lower(p.status);
  end if;
  select * into en from public.entregadores where id = p_entregador and loja_id = p.loja_id;
  if not found or not en.ativo then
    raise exception 'Entregador não encontrado.';
  end if;
  if exists (select 1 from public.entregas where pedido_id = p.id and status = 'Entregue') then
    raise exception 'Este pedido já foi entregue.';
  end if;
  select * into l from public.lojas where id = p.loja_id;

  v_valor := coalesce(p_valor, en.valor_padrao, p.taxa_entrega, 0);
  if v_valor < 0 or v_valor > 1000 then
    raise exception 'Valor do entregador inválido.';
  end if;

  -- trocar de entregador: a entrega anterior deixa de valer
  update public.entregas set status = 'Cancelada' where pedido_id = p.id and status <> 'Cancelada';

  -- mantem o mesmo codigo se o pedido ja tinha um (o cliente ja pode ter visto)
  select codigo into v_codigo from public.entregas where pedido_id = p.id and codigo is not null order by id desc limit 1;
  v_codigo := coalesce(v_codigo, lpad((floor(random() * 10000))::int::text, 4, '0'));

  insert into public.entregas (loja_id, pedido_id, entregador_id, entregador_nome, entregador_whatsapp,
                               valor_entregador, taxa_cliente, cobrar, forma_pagamento, codigo, data_ref)
  values (p.loja_id, p.id, en.id, en.nome, en.whatsapp, v_valor, p.taxa_entrega,
          case when coalesce(p.pago, false) then 0 else p.total end, p.pagamento, v_codigo, p.data_ref)
  returning token into v_token;

  return jsonb_build_object('token', v_token, 'valor_entregador', v_valor, 'codigo_obrigatorio', l.codigo_entrega);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. PAGINA DO ENTREGADOR (link com token, sem login)
-- ---------------------------------------------------------------------
create or replace function public.entrega_publica(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'status', e.status, 'entregador', e.entregador_nome,
    'valor_entregador', e.valor_entregador, 'cobrar', e.cobrar, 'forma_pagamento', e.forma_pagamento,
    'recebido', e.recebido, 'saiu_em', e.saiu_em, 'entregue_em', e.entregue_em,
    'precisa_codigo', l.codigo_entrega and e.codigo is not null,
    'pedido', jsonb_build_object(
      'numero', p.numero, 'status', p.status, 'cliente_nome', p.cliente_nome, 'telefone', p.telefone,
      'endereco', p.endereco, 'latitude', p.latitude, 'longitude', p.longitude, 'distancia_km', p.distancia_km,
      'observacao', p.observacao, 'troco_para', p.troco_para, 'total', p.total, 'criado_em', p.criado_em,
      'itens', coalesce((select jsonb_agg(jsonb_build_object('nome', i.nome, 'tamanho', i.tamanho,
                          'quantidade', i.quantidade, 'opcoes', i.opcoes, 'observacao', i.observacao) order by i.id)
                         from public.itens_pedido i where i.pedido_id = p.id), '[]'::jsonb)),
    'loja', jsonb_build_object('nome', l.nome, 'whatsapp', l.whatsapp, 'endereco', l.endereco,
                               'cor_primaria', l.cor_primaria, 'logo_url', l.logo_url,
                               'latitude', l.latitude, 'longitude', l.longitude))
  from public.entregas e
  join public.pedidos p on p.id = e.pedido_id
  join public.lojas l on l.id = e.loja_id
  where e.token = p_token;
$$;

-- p_acao: 'saiu' ou 'entregue'. Erro de codigo volta como {ok:false} (para contar tentativas).
create or replace function public.entrega_atualizar(p_token uuid, p_acao text, p_codigo text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  e public.entregas%rowtype;
  p public.pedidos%rowtype;
  l public.lojas%rowtype;
begin
  select * into e from public.entregas where token = p_token for update;
  if not found then
    raise exception 'Entrega não encontrada. Confira o link com a loja.';
  end if;
  if e.status = 'Cancelada' then
    raise exception 'Esta entrega foi cancelada ou passada para outro entregador.';
  end if;
  select * into p from public.pedidos where id = e.pedido_id;
  select * into l from public.lojas where id = e.loja_id;
  if p.status = 'Cancelado' then
    raise exception 'O pedido foi cancelado pela loja.';
  end if;

  if p_acao = 'saiu' then
    if e.status = 'Enviada' then
      update public.entregas set status = 'A caminho', saiu_em = now() where id = e.id;
      update public.pedidos set status = 'Saiu para entrega'
       where id = p.id and status in ('Recebido','Em preparo','Pronto');
    end if;
  elsif p_acao = 'entregue' then
    if e.status <> 'Entregue' then
      if l.codigo_entrega and e.codigo is not null then
        if e.tentativas >= 8 then
          return jsonb_build_object('ok', false, 'erro', 'Muitas tentativas erradas. Ligue para a loja.');
        end if;
        if coalesce(trim(p_codigo), '') <> e.codigo then
          update public.entregas set tentativas = tentativas + 1 where id = e.id;
          return jsonb_build_object('ok', false, 'erro', 'Código errado. Peça ao cliente o código de 4 números do pedido.');
        end if;
      end if;
      -- Pix nao pago: o entregador nao recebe nada; a loja confere o Pix e marca "Pago" no painel
      update public.entregas set status = 'Entregue', entregue_em = now(), saiu_em = coalesce(saiu_em, now()),
             recebido = case when coalesce(forma_pagamento,'') = 'Pix' then 0 else cobrar end where id = e.id;
      update public.pedidos set status = 'Finalizado',
             pago = case when coalesce(e.forma_pagamento,'') = 'Pix' and e.cobrar > 0 then p.pago else true end
       where id = p.id;
    end if;
  else
    raise exception 'Ação inválida.';
  end if;

  return jsonb_build_object('ok', true, 'entrega', public.entrega_publica(p_token));
end;
$$;

-- ---------------------------------------------------------------------
-- 4. ACOMPANHAMENTO DO CLIENTE (mostra entregador e codigo)
-- ---------------------------------------------------------------------
create or replace function public.acompanhar_pedido(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'numero', p.numero, 'status', p.status, 'tipo_atendimento', p.tipo_atendimento,
    'cliente_nome', p.cliente_nome, 'criado_em', p.criado_em, 'atualizado_em', p.atualizado_em,
    'pagamento', p.pagamento, 'subtotal', p.subtotal, 'taxa_entrega', p.taxa_entrega,
    'total', p.total, 'motivo_cancelamento', p.motivo_cancelamento,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('nome', i.nome, 'tamanho', i.tamanho,
                                          'opcoes', i.opcoes, 'quantidade', i.quantidade,
                                          'total', i.total) order by i.id)
      from public.itens_pedido i where i.pedido_id = p.id), '[]'::jsonb),
    'loja', jsonb_build_object('nome', l.nome, 'slug', l.slug, 'whatsapp', l.whatsapp,
                               'cor_primaria', l.cor_primaria, 'logo_url', l.logo_url,
                               'chave_pix', l.chave_pix),
    'entrega', (
      select jsonb_build_object(
        'entregador', split_part(e.entregador_nome, ' ', 1), 'status', e.status,
        'saiu_em', e.saiu_em, 'entregue_em', e.entregue_em,
        -- o codigo so aparece para o cliente (link dele) e so se a loja usa codigo
        'codigo', case when l.codigo_entrega and e.status <> 'Entregue' then e.codigo end)
      from public.entregas e
      where e.pedido_id = p.id and e.status <> 'Cancelada'
      order by e.id desc limit 1))
  from public.pedidos p
  join public.lojas l on l.id = p.loja_id
  where p.tracking_token = p_token;
$$;

-- ---------------------------------------------------------------------
-- 5. PERMISSOES
-- ---------------------------------------------------------------------
revoke all on function public.despachar_pedido(bigint, bigint, numeric) from public, anon, authenticated;
revoke all on function public.entrega_publica(uuid)                    from public, anon, authenticated;
revoke all on function public.entrega_atualizar(uuid, text, text)      from public, anon, authenticated;
revoke all on function public.acompanhar_pedido(uuid)                  from public, anon, authenticated;

grant execute on function public.despachar_pedido(bigint, bigint, numeric) to authenticated;
grant execute on function public.entrega_publica(uuid)                    to anon, authenticated;
grant execute on function public.entrega_atualizar(uuid, text, text)      to anon, authenticated;
grant execute on function public.acompanhar_pedido(uuid)                  to anon, authenticated;

notify pgrst, 'reload schema';
