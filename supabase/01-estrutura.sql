-- =====================================================================
-- WL PEDIDOS - ESTRUTURA DO BANCO (multi-loja)
-- WL Sistemas
--
-- Execute UMA vez, num projeto NOVO do Supabase:
--   Supabase > SQL Editor > New query > cole tudo > Run
--
-- Principios de seguranca:
--   * Cada loja so enxerga os proprios dados (RLS por loja_id).
--   * O cliente final (anonimo) NAO acessa tabelas: so le o cardapio e
--     cria pedidos por funcoes seguras.
--   * O preco do pedido e SEMPRE recalculado no banco. O valor enviado
--     pelo navegador e ignorado.
--   * O super admin (WL Sistemas) cria lojas e da acesso aos donos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------

create table if not exists public.super_admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

create table if not exists public.lojas (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique
                   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 40),
  nome             text not null check (length(trim(nome)) between 2 and 80),
  ativa            boolean not null default true,   -- controlado pela WL (ex.: mensalidade)
  aberta           boolean not null default true,   -- controlado pela loja (abrir/fechar)
  mensagem_fechada text check (length(mensagem_fechada) <= 200),
  logo_url         text check (length(logo_url) <= 500),
  cor_primaria     text not null default '#0f766e' check (cor_primaria ~ '^#[0-9a-fA-F]{6}$'),
  whatsapp         text check (length(whatsapp) <= 20),
  chave_pix        text check (length(chave_pix) <= 120),
  endereco         text check (length(endereco) <= 200),
  taxa_entrega     numeric(10,2) not null default 0 check (taxa_entrega >= 0),
  pedido_minimo    numeric(10,2) not null default 0 check (pedido_minimo >= 0),
  aceita_delivery  boolean not null default true,
  aceita_retirada  boolean not null default true,
  aceita_mesa      boolean not null default false,
  formas_pagamento text[] not null default array['Pix','Dinheiro','Cartão'],
  fuso             text not null default 'America/Sao_Paulo',
  criado_em        timestamptz not null default now()
);

create table if not exists public.loja_membros (
  loja_id   uuid not null references public.lojas(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  papel     text not null default 'dono' check (papel in ('dono','atendente')),
  criado_em timestamptz not null default now(),
  primary key (loja_id, user_id)
);

create table if not exists public.categorias (
  id      bigint generated always as identity primary key,
  loja_id uuid not null references public.lojas(id) on delete cascade,
  nome    text not null check (length(trim(nome)) between 1 and 60),
  ordem   integer not null default 0,
  ativa   boolean not null default true
);
create index if not exists idx_categorias_loja on public.categorias(loja_id);

create table if not exists public.produtos (
  id           bigint generated always as identity primary key,
  loja_id      uuid not null references public.lojas(id) on delete cascade,
  categoria_id bigint references public.categorias(id) on delete set null,
  nome         text not null check (length(trim(nome)) between 1 and 80),
  descricao    text check (length(descricao) <= 300),
  imagem_url   text check (length(imagem_url) <= 500),
  preco        numeric(10,2) check (preco is null or preco >= 0), -- usado quando nao ha tamanhos
  ativo        boolean not null default true,   -- aparece no cardapio
  disponivel   boolean not null default true,   -- false = "esgotado" temporariamente
  ordem        integer not null default 0,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_produtos_loja on public.produtos(loja_id);

-- Ex.: 400 ml / 500 ml, Pequena / Grande
create table if not exists public.produto_tamanhos (
  id         bigint generated always as identity primary key,
  produto_id bigint not null references public.produtos(id) on delete cascade,
  loja_id    uuid not null references public.lojas(id) on delete cascade,
  nome       text not null check (length(trim(nome)) between 1 and 40),
  preco      numeric(10,2) not null check (preco >= 0),
  ordem      integer not null default 0
);
create index if not exists idx_tamanhos_produto on public.produto_tamanhos(produto_id);

-- Ex.: "Frutas" (min 1, max 3), "Coberturas" (min 0, max sem limite)
create table if not exists public.grupos_opcoes (
  id         bigint generated always as identity primary key,
  produto_id bigint not null references public.produtos(id) on delete cascade,
  loja_id    uuid not null references public.lojas(id) on delete cascade,
  nome       text not null check (length(trim(nome)) between 1 and 60),
  minimo     integer not null default 0 check (minimo >= 0),
  maximo     integer check (maximo is null or maximo >= 1),  -- null = sem limite
  ordem      integer not null default 0,
  check (maximo is null or maximo >= minimo)
);
create index if not exists idx_grupos_produto on public.grupos_opcoes(produto_id);

create table if not exists public.opcoes (
  id         bigint generated always as identity primary key,
  grupo_id   bigint not null references public.grupos_opcoes(id) on delete cascade,
  loja_id    uuid not null references public.lojas(id) on delete cascade,
  nome       text not null check (length(trim(nome)) between 1 and 60),
  preco      numeric(10,2) not null default 0 check (preco >= 0),
  disponivel boolean not null default true,
  ordem      integer not null default 0
);
create index if not exists idx_opcoes_grupo on public.opcoes(grupo_id);

create table if not exists public.pedidos (
  id                  bigint generated always as identity primary key,
  loja_id             uuid not null references public.lojas(id) on delete cascade,
  numero              integer not null,           -- sequencia diaria por loja: 1, 2, 3...
  data_ref            date not null,              -- dia do pedido no fuso da loja
  cliente_nome        text not null,
  telefone            text,
  tipo_atendimento    text not null check (tipo_atendimento in ('Delivery','Retirada','Mesa')),
  endereco            text,
  mesa                text,
  pagamento           text,
  troco_para          numeric(10,2),
  observacao          text,
  subtotal            numeric(10,2) not null,
  taxa_entrega        numeric(10,2) not null default 0,
  total               numeric(10,2) not null,
  status              text not null default 'Recebido'
                      check (status in ('Recebido','Em preparo','Saiu para entrega','Pronto','Finalizado','Cancelado')),
  motivo_cancelamento text check (length(motivo_cancelamento) <= 200),
  origem              text not null default 'Cliente' check (origem in ('Cliente','Manual')),
  tracking_token      uuid not null unique default gen_random_uuid(),
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  unique (loja_id, data_ref, numero)
);
create index if not exists idx_pedidos_loja_data on public.pedidos(loja_id, criado_em desc);

create table if not exists public.itens_pedido (
  id             bigint generated always as identity primary key,
  pedido_id      bigint not null references public.pedidos(id) on delete cascade,
  loja_id        uuid not null references public.lojas(id) on delete cascade,
  produto_id     bigint references public.produtos(id) on delete set null,
  nome           text not null,
  tamanho        text,
  opcoes         jsonb not null default '[]'::jsonb,  -- copia do que foi escolhido
  observacao     text,
  preco_unitario numeric(10,2) not null,
  quantidade     integer not null check (quantidade between 1 and 99),
  total          numeric(10,2) not null
);
create index if not exists idx_itens_pedido on public.itens_pedido(pedido_id);

create table if not exists public.contador_pedidos (
  loja_id uuid not null references public.lojas(id) on delete cascade,
  data    date not null,
  ultimo  integer not null,
  primary key (loja_id, data)
);

-- Preparado para o modulo financeiro (proxima versao)
create table if not exists public.despesas (
  id        bigint generated always as identity primary key,
  loja_id   uuid not null references public.lojas(id) on delete cascade,
  descricao text not null check (length(trim(descricao)) between 1 and 120),
  categoria text check (length(categoria) <= 60),
  valor     numeric(10,2) not null check (valor >= 0),
  data      date not null default current_date,
  criado_em timestamptz not null default now()
);
create index if not exists idx_despesas_loja on public.despesas(loja_id, data desc);

-- ---------------------------------------------------------------------
-- 2. FUNCOES DE PERMISSAO
-- ---------------------------------------------------------------------

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.super_admins where user_id = auth.uid());
$$;

create or replace function public.pode_gerenciar(p_loja uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.loja_membros m where m.loja_id = p_loja and m.user_id = auth.uid())
    or exists (select 1 from public.super_admins s where s.user_id = auth.uid())
  );
$$;

-- Usada pelo armazenamento de imagens: caminho "<loja_id>/arquivo.jpg"
create or replace function public.pode_gerenciar_caminho(p_nome text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when split_part(p_nome, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.pode_gerenciar(split_part(p_nome, '/', 1)::uuid)
    else false
  end;
$$;

-- ---------------------------------------------------------------------
-- 3. SEGURANCA DAS TABELAS (RLS + permissoes por coluna)
-- ---------------------------------------------------------------------

alter table public.super_admins     enable row level security;
alter table public.lojas            enable row level security;
alter table public.loja_membros     enable row level security;
alter table public.categorias       enable row level security;
alter table public.produtos         enable row level security;
alter table public.produto_tamanhos enable row level security;
alter table public.grupos_opcoes    enable row level security;
alter table public.opcoes           enable row level security;
alter table public.pedidos          enable row level security;
alter table public.itens_pedido     enable row level security;
alter table public.contador_pedidos enable row level security;
alter table public.despesas         enable row level security;

-- O Supabase concede tudo por padrao; removemos e concedemos so o necessario.
revoke all on table
  public.super_admins, public.lojas, public.loja_membros, public.categorias,
  public.produtos, public.produto_tamanhos, public.grupos_opcoes, public.opcoes,
  public.pedidos, public.itens_pedido, public.contador_pedidos, public.despesas
from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Lojas: a loja edita a propria configuracao; slug e "ativa" so pela WL.
grant select on public.lojas to authenticated;
grant update (nome, aberta, mensagem_fechada, logo_url, cor_primaria, whatsapp, chave_pix,
              endereco, taxa_entrega, pedido_minimo, aceita_delivery, aceita_retirada,
              aceita_mesa, formas_pagamento)
  on public.lojas to authenticated;

drop policy if exists "lojas_select" on public.lojas;
create policy "lojas_select" on public.lojas for select to authenticated
  using (public.pode_gerenciar(id));
drop policy if exists "lojas_update" on public.lojas;
create policy "lojas_update" on public.lojas for update to authenticated
  using (public.pode_gerenciar(id)) with check (public.pode_gerenciar(id));

grant select on public.loja_membros to authenticated;
drop policy if exists "membros_select" on public.loja_membros;
create policy "membros_select" on public.loja_membros for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- Categorias: CRUD direto pelo painel.
grant select, insert, delete on public.categorias to authenticated;
grant update (nome, ordem, ativa) on public.categorias to authenticated;
drop policy if exists "categorias_all" on public.categorias;
create policy "categorias_all" on public.categorias for all to authenticated
  using (public.pode_gerenciar(loja_id)) with check (public.pode_gerenciar(loja_id));

-- Produtos: criados/editados pela funcao salvar_produto; o painel so
-- liga/desliga, reordena e exclui direto.
grant select, delete on public.produtos to authenticated;
grant update (ativo, disponivel, ordem) on public.produtos to authenticated;
drop policy if exists "produtos_all" on public.produtos;
create policy "produtos_all" on public.produtos for all to authenticated
  using (public.pode_gerenciar(loja_id)) with check (public.pode_gerenciar(loja_id));

grant select on public.produto_tamanhos, public.grupos_opcoes to authenticated;
drop policy if exists "tamanhos_select" on public.produto_tamanhos;
create policy "tamanhos_select" on public.produto_tamanhos for select to authenticated
  using (public.pode_gerenciar(loja_id));
drop policy if exists "grupos_select" on public.grupos_opcoes;
create policy "grupos_select" on public.grupos_opcoes for select to authenticated
  using (public.pode_gerenciar(loja_id));

-- Opcoes: o painel pode pausar um adicional (ex.: acabou o morango).
grant select on public.opcoes to authenticated;
grant update (disponivel) on public.opcoes to authenticated;
drop policy if exists "opcoes_all" on public.opcoes;
create policy "opcoes_all" on public.opcoes for all to authenticated
  using (public.pode_gerenciar(loja_id)) with check (public.pode_gerenciar(loja_id));

-- Pedidos: a loja le, muda status/cancela e so exclui pedido cancelado.
grant select, delete on public.pedidos to authenticated;
grant update (status, motivo_cancelamento) on public.pedidos to authenticated;
drop policy if exists "pedidos_select" on public.pedidos;
create policy "pedidos_select" on public.pedidos for select to authenticated
  using (public.pode_gerenciar(loja_id));
drop policy if exists "pedidos_update" on public.pedidos;
create policy "pedidos_update" on public.pedidos for update to authenticated
  using (public.pode_gerenciar(loja_id)) with check (public.pode_gerenciar(loja_id));
drop policy if exists "pedidos_delete" on public.pedidos;
create policy "pedidos_delete" on public.pedidos for delete to authenticated
  using (public.pode_gerenciar(loja_id) and status = 'Cancelado');

grant select on public.itens_pedido to authenticated;
drop policy if exists "itens_select" on public.itens_pedido;
create policy "itens_select" on public.itens_pedido for select to authenticated
  using (public.pode_gerenciar(loja_id));

grant select, insert, delete on public.despesas to authenticated;
grant update (descricao, categoria, valor, data) on public.despesas to authenticated;
drop policy if exists "despesas_all" on public.despesas;
create policy "despesas_all" on public.despesas for all to authenticated
  using (public.pode_gerenciar(loja_id)) with check (public.pode_gerenciar(loja_id));

-- super_admins e contador_pedidos: sem acesso direto (apenas funcoes).

-- Mantem atualizado_em em dia
create or replace function public.tg_pedidos_atualizado()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  if new.status <> 'Cancelado' then
    new.motivo_cancelamento := null;
  end if;
  return new;
end;
$$;
drop trigger if exists pedidos_atualizado on public.pedidos;
create trigger pedidos_atualizado before update on public.pedidos
  for each row execute function public.tg_pedidos_atualizado();

-- ---------------------------------------------------------------------
-- 4. FUNCOES PUBLICAS (cliente final, sem login)
-- ---------------------------------------------------------------------

create or replace function public.formatar_reais(v numeric)
returns text language sql immutable as $$
  select 'R$ ' || replace(to_char(coalesce(v,0), 'FM999999990.00'), '.', ',');
$$;

-- Cardapio completo de uma loja pelo link (slug)
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
      'slug', l.slug, 'nome', l.nome, 'ativa', true, 'aberta', l.aberta,
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

-- Cria um pedido. Usada pelo cliente (sem login) e pelo balcao (logado).
--   p_pedido: {cliente_nome, telefone, tipo_atendimento, endereco, mesa,
--              pagamento, troco_para, observacao, origem}
--   p_itens:  [{produto_id, tamanho_id, opcoes:[ids], quantidade, observacao}]
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
begin
  select * into l from public.lojas where slug = lower(trim(coalesce(p_slug,'')));
  if not found or not l.ativa then
    raise exception 'Esta loja não está disponível no momento.';
  end if;

  v_manual := coalesce(p_pedido->>'origem','') = 'Manual' and public.pode_gerenciar(l.id);

  if not l.aberta and not v_manual then
    raise exception '%', coalesce(nullif(trim(l.mensagem_fechada),''), 'A loja está fechada no momento.');
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

  if v_tipo = 'Delivery' then
    v_taxa := l.taxa_entrega;
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
    pagamento, troco_para, observacao, subtotal, taxa_entrega, total, origem)
  values (
    l.id, v_numero, v_data, v_nome, nullif(v_tel,''), v_tipo, v_endereco, v_mesa,
    v_pag, v_troco, v_obs, v_subtotal, v_taxa, v_total,
    case when v_manual then 'Manual' else 'Cliente' end)
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
    'subtotal', v_subtotal, 'taxa_entrega', v_taxa, 'total', v_total);
end;
$$;

-- Acompanhamento do pedido pelo link com token
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
                               'chave_pix', l.chave_pix))
  from public.pedidos p
  join public.lojas l on l.id = p.loja_id
  where p.tracking_token = p_token;
$$;

-- ---------------------------------------------------------------------
-- 5. FUNCOES DO PAINEL DA LOJA
-- ---------------------------------------------------------------------

-- Cria ou edita um produto com tamanhos, grupos e opcoes de uma vez.
--   p: {id?, categoria_id, nome, descricao, imagem_url, preco, ativo, disponivel, ordem,
--       tamanhos:[{id?, nome, preco}],
--       grupos:[{id?, nome, minimo, maximo, opcoes:[{id?, nome, preco, disponivel}]}]}
create or replace function public.salvar_produto(p_loja uuid, p jsonb)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare
  v_id      bigint := nullif(p->>'id','')::bigint;
  v_cat     bigint := nullif(p->>'categoria_id','')::bigint;
  v_preco   numeric(10,2) := nullif(p->>'preco','')::numeric;
  v_keep    bigint[];
  v_keep_o  bigint[];
  v_t       jsonb;
  v_g       jsonb;
  v_o       jsonb;
  v_gid     bigint;
  v_ordem   integer;
  v_ordem_o integer;
begin
  if not public.pode_gerenciar(p_loja) then
    raise exception 'Sem permissão para esta loja.';
  end if;
  if v_cat is not null and not exists (select 1 from public.categorias where id = v_cat and loja_id = p_loja) then
    raise exception 'Categoria inválida.';
  end if;
  if coalesce(jsonb_array_length(coalesce(p->'tamanhos','[]'::jsonb)),0) = 0 and v_preco is null then
    raise exception 'Informe o preço do produto ou cadastre tamanhos.';
  end if;

  if v_id is null then
    insert into public.produtos (loja_id, categoria_id, nome, descricao, imagem_url, preco, ativo, disponivel, ordem)
    values (p_loja, v_cat, trim(p->>'nome'), nullif(trim(coalesce(p->>'descricao','')),''),
            nullif(trim(coalesce(p->>'imagem_url','')),''), v_preco,
            coalesce((p->>'ativo')::boolean, true), coalesce((p->>'disponivel')::boolean, true),
            coalesce((p->>'ordem')::integer, 0))
    returning id into v_id;
  else
    update public.produtos set
      categoria_id = v_cat,
      nome = trim(p->>'nome'),
      descricao = nullif(trim(coalesce(p->>'descricao','')),''),
      imagem_url = nullif(trim(coalesce(p->>'imagem_url','')),''),
      preco = v_preco,
      ativo = coalesce((p->>'ativo')::boolean, ativo),
      disponivel = coalesce((p->>'disponivel')::boolean, disponivel),
      ordem = coalesce((p->>'ordem')::integer, ordem)
    where id = v_id and loja_id = p_loja;
    if not found then
      raise exception 'Produto não encontrado.';
    end if;
  end if;

  -- Tamanhos
  select coalesce(array_agg((t->>'id')::bigint) filter (where nullif(t->>'id','') is not null), '{}')
  into v_keep from jsonb_array_elements(coalesce(p->'tamanhos','[]'::jsonb)) t;
  delete from public.produto_tamanhos where produto_id = v_id and not (id = any(v_keep));

  v_ordem := 0;
  for v_t in select * from jsonb_array_elements(coalesce(p->'tamanhos','[]'::jsonb)) loop
    v_ordem := v_ordem + 1;
    if nullif(v_t->>'id','') is not null then
      update public.produto_tamanhos
      set nome = trim(v_t->>'nome'), preco = (v_t->>'preco')::numeric, ordem = v_ordem
      where id = (v_t->>'id')::bigint and produto_id = v_id;
      if not found then raise exception 'Tamanho inválido.'; end if;
    else
      insert into public.produto_tamanhos (produto_id, loja_id, nome, preco, ordem)
      values (v_id, p_loja, trim(v_t->>'nome'), (v_t->>'preco')::numeric, v_ordem);
    end if;
  end loop;

  -- Grupos e opcoes
  select coalesce(array_agg((g->>'id')::bigint) filter (where nullif(g->>'id','') is not null), '{}')
  into v_keep from jsonb_array_elements(coalesce(p->'grupos','[]'::jsonb)) g;
  delete from public.grupos_opcoes where produto_id = v_id and not (id = any(v_keep));

  v_ordem := 0;
  for v_g in select * from jsonb_array_elements(coalesce(p->'grupos','[]'::jsonb)) loop
    v_ordem := v_ordem + 1;
    if nullif(v_g->>'id','') is not null then
      update public.grupos_opcoes
      set nome = trim(v_g->>'nome'),
          minimo = coalesce(nullif(v_g->>'minimo','')::integer, 0),
          maximo = nullif(v_g->>'maximo','')::integer,
          ordem = v_ordem
      where id = (v_g->>'id')::bigint and produto_id = v_id
      returning id into v_gid;
      if v_gid is null then raise exception 'Grupo de opções inválido.'; end if;
    else
      insert into public.grupos_opcoes (produto_id, loja_id, nome, minimo, maximo, ordem)
      values (v_id, p_loja, trim(v_g->>'nome'),
              coalesce(nullif(v_g->>'minimo','')::integer, 0),
              nullif(v_g->>'maximo','')::integer, v_ordem)
      returning id into v_gid;
    end if;

    select coalesce(array_agg((o->>'id')::bigint) filter (where nullif(o->>'id','') is not null), '{}')
    into v_keep_o from jsonb_array_elements(coalesce(v_g->'opcoes','[]'::jsonb)) o;
    delete from public.opcoes where grupo_id = v_gid and not (id = any(v_keep_o));

    v_ordem_o := 0;
    for v_o in select * from jsonb_array_elements(coalesce(v_g->'opcoes','[]'::jsonb)) loop
      v_ordem_o := v_ordem_o + 1;
      if nullif(v_o->>'id','') is not null then
        update public.opcoes
        set nome = trim(v_o->>'nome'),
            preco = coalesce(nullif(v_o->>'preco','')::numeric, 0),
            disponivel = coalesce((v_o->>'disponivel')::boolean, true),
            ordem = v_ordem_o
        where id = (v_o->>'id')::bigint and grupo_id = v_gid;
        if not found then raise exception 'Opção inválida.'; end if;
      else
        insert into public.opcoes (grupo_id, loja_id, nome, preco, disponivel, ordem)
        values (v_gid, p_loja, trim(v_o->>'nome'),
                coalesce(nullif(v_o->>'preco','')::numeric, 0),
                coalesce((v_o->>'disponivel')::boolean, true), v_ordem_o);
      end if;
    end loop;
    v_gid := null;
  end loop;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. FUNCOES DO PAINEL MASTER (WL Sistemas)
-- ---------------------------------------------------------------------

create or replace function public.master_listar_lojas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Acesso restrito à WL Sistemas.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'slug', l.slug, 'nome', l.nome, 'ativa', l.ativa, 'aberta', l.aberta,
      'criado_em', l.criado_em,
      'membros', coalesce((
        select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'papel', m.papel)
                         order by u.email)
        from public.loja_membros m join auth.users u on u.id = m.user_id
        where m.loja_id = l.id), '[]'::jsonb),
      'pedidos_30d', (select count(*) from public.pedidos p
                      where p.loja_id = l.id and p.status <> 'Cancelado'
                        and p.criado_em > now() - interval '30 days'),
      'vendas_30d', (select coalesce(sum(p.total),0) from public.pedidos p
                     where p.loja_id = l.id and p.status <> 'Cancelado'
                       and p.criado_em > now() - interval '30 days'))
      order by l.criado_em desc)
    from public.lojas l), '[]'::jsonb);
end;
$$;

create or replace function public.master_criar_loja(p_nome text, p_slug text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Acesso restrito à WL Sistemas.';
  end if;
  if exists (select 1 from public.lojas where slug = lower(trim(p_slug))) then
    raise exception 'Já existe uma loja com o link "%".', lower(trim(p_slug));
  end if;
  insert into public.lojas (nome, slug) values (trim(p_nome), lower(trim(p_slug)))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.master_atualizar_loja(p_loja uuid, p_ativa boolean, p_slug text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Acesso restrito à WL Sistemas.';
  end if;
  update public.lojas
  set ativa = coalesce(p_ativa, ativa),
      slug  = coalesce(nullif(lower(trim(p_slug)),''), slug)
  where id = p_loja;
  if not found then raise exception 'Loja não encontrada.'; end if;
end;
$$;

-- O usuario precisa existir antes em Authentication > Users.
create or replace function public.master_vincular_usuario(p_loja uuid, p_email text, p_papel text default 'dono')
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Acesso restrito à WL Sistemas.';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'Usuário % não existe. Crie primeiro em Supabase > Authentication > Users.', p_email;
  end if;
  insert into public.loja_membros (loja_id, user_id, papel)
  values (p_loja, v_user, coalesce(nullif(p_papel,''),'dono'))
  on conflict (loja_id, user_id) do update set papel = excluded.papel;
end;
$$;

create or replace function public.master_remover_usuario(p_loja uuid, p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Acesso restrito à WL Sistemas.';
  end if;
  delete from public.loja_membros where loja_id = p_loja and user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. QUEM PODE CHAMAR CADA FUNCAO
-- ---------------------------------------------------------------------

revoke all on function public.is_super_admin()                       from public, anon, authenticated;
revoke all on function public.pode_gerenciar(uuid)                   from public, anon, authenticated;
revoke all on function public.pode_gerenciar_caminho(text)           from public, anon, authenticated;
revoke all on function public.tg_pedidos_atualizado()                from public, anon, authenticated;
revoke all on function public.formatar_reais(numeric)                from public, anon, authenticated;
revoke all on function public.cardapio_publico(text)                 from public, anon, authenticated;
revoke all on function public.criar_pedido(text, jsonb, jsonb)       from public, anon, authenticated;
revoke all on function public.acompanhar_pedido(uuid)                from public, anon, authenticated;
revoke all on function public.salvar_produto(uuid, jsonb)            from public, anon, authenticated;
revoke all on function public.master_listar_lojas()                  from public, anon, authenticated;
revoke all on function public.master_criar_loja(text, text)          from public, anon, authenticated;
revoke all on function public.master_atualizar_loja(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.master_vincular_usuario(uuid, text, text)  from public, anon, authenticated;
revoke all on function public.master_remover_usuario(uuid, uuid)     from public, anon, authenticated;

grant execute on function public.cardapio_publico(text)           to anon, authenticated;
grant execute on function public.criar_pedido(text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.acompanhar_pedido(uuid)          to anon, authenticated;

grant execute on function public.is_super_admin()                 to authenticated;
grant execute on function public.pode_gerenciar(uuid)             to authenticated;
grant execute on function public.pode_gerenciar_caminho(text)     to authenticated;
grant execute on function public.salvar_produto(uuid, jsonb)      to authenticated;
grant execute on function public.master_listar_lojas()            to authenticated;
grant execute on function public.master_criar_loja(text, text)    to authenticated;
grant execute on function public.master_atualizar_loja(uuid, boolean, text) to authenticated;
grant execute on function public.master_vincular_usuario(uuid, text, text)  to authenticated;
grant execute on function public.master_remover_usuario(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. IMAGENS DOS PRODUTOS (Supabase Storage)
--    Arquivos em imagens/<id-da-loja>/arquivo.jpg, leitura publica.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('imagens', 'imagens', true)
on conflict (id) do nothing;

drop policy if exists "wl_imagens_ler" on storage.objects;
create policy "wl_imagens_ler" on storage.objects for select to authenticated
  using (bucket_id = 'imagens' and public.pode_gerenciar_caminho(name));

drop policy if exists "wl_imagens_inserir" on storage.objects;
create policy "wl_imagens_inserir" on storage.objects for insert to authenticated
  with check (bucket_id = 'imagens' and public.pode_gerenciar_caminho(name));

drop policy if exists "wl_imagens_alterar" on storage.objects;
create policy "wl_imagens_alterar" on storage.objects for update to authenticated
  using (bucket_id = 'imagens' and public.pode_gerenciar_caminho(name));

drop policy if exists "wl_imagens_excluir" on storage.objects;
create policy "wl_imagens_excluir" on storage.objects for delete to authenticated
  using (bucket_id = 'imagens' and public.pode_gerenciar_caminho(name));

-- Fim. Proximo passo: 02-tornar-super-admin.sql
