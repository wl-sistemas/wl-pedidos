// =====================================================================
// WL PEDIDOS - MODO DEMONSTRACAO
// Liga sozinho quando o config.js ainda nao tem os dados do Supabase.
// Tudo fica salvo SO neste navegador (localStorage). Serve para testar
// e mostrar o sistema para clientes. Com o Supabase configurado, este
// arquivo nao faz nada.
// =====================================================================
(function () {
  if (window.WL && window.WL.configurado()) return;

  const CHAVE_DB = "wl_demo_db_v1";
  const CHAVE_SESSAO = "wl_demo_sessao";
  const USUARIOS = {
    "dono@demo.com": { id: "u-dono", senha: "123456" },
    "wl@demo.com": { id: "u-wl", senha: "123456", superAdmin: true }
  };

  // ---------------- Armazenamento ----------------
  let memoria = null;
  function ler(chave) {
    try { return JSON.parse(localStorage.getItem(chave)); } catch (e) { return memoria && memoria[chave]; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); }
    catch (e) {
      if (e && e.name === "QuotaExceededError") throw new Error("O armazenamento do navegador encheu. Use imagens menores.");
      memoria = memoria || {}; memoria[chave] = valor;
    }
  }

  function semente() {
    const db = { seq: 100, lojas: [], loja_membros: [], categorias: [], produtos: [], produto_tamanhos: [],
                 grupos_opcoes: [], opcoes: [], pedidos: [], itens_pedido: [], contador: {} };
    const id = () => ++db.seq;
    const loja = {
      id: "loja-demo", slug: "demo", nome: "Lanchonete Demonstração", ativa: true, aberta: true,
      mensagem_fechada: null, logo_url: null, cor_primaria: "#7c3aed", whatsapp: "43999999999",
      chave_pix: "pix@exemplo.com", endereco: "Rua Exemplo, 100 - Centro", taxa_entrega: 5, pedido_minimo: 15,
      aceita_delivery: true, aceita_retirada: true, aceita_mesa: true,
      formas_pagamento: ["Pix", "Dinheiro", "Cartão"], fuso: "America/Sao_Paulo", criado_em: new Date().toISOString()
    };
    db.lojas.push(loja);
    db.loja_membros.push({ loja_id: loja.id, user_id: "u-dono", papel: "dono", email: "dono@demo.com" });

    const cat = (nome, ordem) => { const c = { id: id(), loja_id: loja.id, nome, ordem, ativa: true }; db.categorias.push(c); return c.id; };
    const prod = (categoria_id, nome, descricao, preco, ordem) => {
      const p = { id: id(), loja_id: loja.id, categoria_id, nome, descricao, imagem_url: null, preco,
                  ativo: true, disponivel: true, ordem, criado_em: new Date().toISOString() };
      db.produtos.push(p); return p.id;
    };
    const tam = (produto_id, nome, preco, ordem) => db.produto_tamanhos.push({ id: id(), produto_id, loja_id: loja.id, nome, preco, ordem });
    const grupo = (produto_id, nome, minimo, maximo, ordem, opcoes) => {
      const g = { id: id(), produto_id, loja_id: loja.id, nome, minimo, maximo, ordem };
      db.grupos_opcoes.push(g);
      opcoes.forEach(([n, preco], i) => db.opcoes.push({ id: id(), grupo_id: g.id, loja_id: loja.id, nome: n, preco, disponivel: true, ordem: i + 1 }));
    };

    const acai = cat("Açaí", 1), lanches = cat("Lanches", 2), bebidas = cat("Bebidas", 3);
    let p = prod(acai, "Açaí Monte do Seu Jeito", "Escolha o tamanho, até 3 frutas, complementos e a cobertura.", null, 1);
    tam(p, "300 ml", 14, 1); tam(p, "500 ml", 18, 2); tam(p, "700 ml", 24, 3);
    grupo(p, "Frutas", 0, 3, 1, [["Morango", 0], ["Banana", 0], ["Kiwi", 2]]);
    grupo(p, "Complementos", 0, null, 2, [["Leite em pó", 2], ["Granola", 2], ["Paçoca", 2.5]]);
    grupo(p, "Cobertura", 1, 1, 3, [["Leite condensado", 0], ["Mel", 0], ["Creme de chocolate", 1.5]]);
    p = prod(lanches, "X-Burguer", "Pão, hambúrguer artesanal 150 g, queijo e maionese da casa.", 22, 1);
    grupo(p, "Adicionais", 0, null, 1, [["Bacon", 4], ["Ovo", 2], ["Cheddar", 3]]);
    prod(lanches, "X-Salada", "Pão, hambúrguer 150 g, queijo, alface, tomate e maionese.", 24, 2);
    p = prod(bebidas, "Refrigerante lata", null, 6, 1);
    grupo(p, "Sabor", 1, 1, 1, [["Cola", 0], ["Guaraná", 0], ["Laranja", 0]]);
    p = prod(bebidas, "Suco natural", "Feito na hora.", null, 2);
    tam(p, "300 ml", 8, 1); tam(p, "500 ml", 11, 2);
    grupo(p, "Sabor", 1, 1, 1, [["Laranja", 0], ["Limão", 0], ["Maracujá", 0]]);
    return db;
  }

  function carregarDb() { return ler(CHAVE_DB) || semente(); }
  function salvarDb(db) { gravar(CHAVE_DB, db); }
  const copia = o => JSON.parse(JSON.stringify(o));
  const espera = () => new Promise(r => setTimeout(r, 120));
  const n = v => Number(v || 0);
  const reais = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  let sessao = ler(CHAVE_SESSAO);
  const usuario = () => sessao && USUARIOS[sessao.email] ? Object.assign({ email: sessao.email }, USUARIOS[sessao.email]) : null;
  function podeGerenciar(db, lojaId) {
    const u = usuario();
    if (!u) return false;
    return !!u.superAdmin || db.loja_membros.some(m => m.loja_id === lojaId && m.user_id === u.id);
  }
  function exigirLogin() { if (!usuario()) throw new Error("Sua sessão expirou. Entre novamente."); }

  // ---------------- Filtros no formato do Supabase ----------------
  function filtrar(linhas, params) {
    let r = linhas;
    Object.entries(params || {}).forEach(([k, v]) => {
      if (k === "select" || k === "order" || k === "limit" || v == null) return;
      let s = String(v), neg = false;
      if (s.startsWith("not.")) { neg = true; s = s.slice(4); }
      const ponto = s.indexOf(".");
      const op = s.slice(0, ponto), val = s.slice(ponto + 1);
      let teste;
      if (op === "eq") teste = x => String(x[k]) === val;
      else if (op === "neq") teste = x => String(x[k]) !== val;
      else if (op === "in") { const l = val.replace(/^\(|\)$/g, "").split(","); teste = x => l.includes(String(x[k])); }
      else if (op === "gte") teste = x => x[k] >= val;
      else if (op === "lte") teste = x => x[k] <= val;
      else teste = () => true;
      r = r.filter(x => neg ? !teste(x) : teste(x));
    });
    if (params && params.order) {
      const cols = params.order.split(",").map(c => { const [nome, dir] = c.split("."); return { nome, desc: dir === "desc" }; });
      r = r.slice().sort((a, b) => {
        for (const c of cols) {
          if (a[c.nome] < b[c.nome]) return c.desc ? 1 : -1;
          if (a[c.nome] > b[c.nome]) return c.desc ? -1 : 1;
        }
        return 0;
      });
    }
    return r;
  }

  function tabelaVisivel(db, tabela) {
    const linhas = db[tabela];
    if (!linhas) throw new Error("Tabela desconhecida: " + tabela);
    if (tabela === "lojas") return linhas.filter(l => podeGerenciar(db, l.id));
    if (tabela === "loja_membros") return linhas;
    return linhas.filter(l => podeGerenciar(db, l.loja_id));
  }

  // ---------------- Regras do pedido (mesmas do banco real) ----------------
  function criarPedido(db, slug, ped, itens) {
    const l = db.lojas.find(x => x.slug === String(slug || "").trim().toLowerCase());
    if (!l || !l.ativa) throw new Error("Esta loja não está disponível no momento.");
    const manual = ped.origem === "Manual" && podeGerenciar(db, l.id);
    if (!l.aberta && !manual) throw new Error(l.mensagem_fechada || "A loja está fechada no momento.");

    const nome = String(ped.cliente_nome || "").trim().slice(0, 80);
    const tel = String(ped.telefone || "").replace(/\D/g, "").slice(0, 15);
    const tipo = ped.tipo_atendimento;
    let endereco = String(ped.endereco || "").trim().slice(0, 200) || null;
    let mesa = String(ped.mesa || "").trim().slice(0, 20) || null;
    const pag = String(ped.pagamento || "").trim() || null;
    if (!nome) throw new Error("Informe seu nome.");
    if (!manual && tel.length < 10) throw new Error("Informe um WhatsApp válido com DDD.");
    if (!["Delivery", "Retirada", "Mesa"].includes(tipo)) throw new Error("Escolha como deseja receber o pedido.");
    if (!manual && ((tipo === "Delivery" && !l.aceita_delivery) || (tipo === "Retirada" && !l.aceita_retirada) || (tipo === "Mesa" && !l.aceita_mesa)))
      throw new Error("Esta loja não aceita pedidos do tipo " + tipo + ".");
    if (tipo === "Delivery" && (!endereco || endereco.length < 5)) throw new Error("Informe o endereço de entrega.");
    if (tipo === "Mesa" && !mesa) throw new Error("Informe o número da mesa ou comanda.");
    if (tipo !== "Delivery") endereco = null;
    if (tipo !== "Mesa") mesa = null;
    if (l.formas_pagamento.length && !l.formas_pagamento.includes(pag)) throw new Error("Escolha uma forma de pagamento.");
    let troco = pag === "Dinheiro" && n(ped.troco_para) > 0 ? n(ped.troco_para) : null;
    if (!Array.isArray(itens) || !itens.length) throw new Error("Seu carrinho está vazio.");

    let subtotal = 0;
    const calculados = itens.map(it => {
      const p = db.produtos.find(x => x.id === Number(it.produto_id) && x.loja_id === l.id && x.ativo);
      if (!p) throw new Error("Um item do carrinho não está mais no cardápio. Atualize a página.");
      if (!p.disponivel) throw new Error('"' + p.nome + '" está esgotado no momento.');
      const tams = db.produto_tamanhos.filter(t => t.produto_id === p.id);
      let base, tamNome = null;
      if (tams.length) {
        const t = tams.find(x => x.id === Number(it.tamanho_id));
        if (!t) throw new Error('Escolha o tamanho de "' + p.nome + '".');
        base = n(t.preco); tamNome = t.nome;
      } else {
        if (p.preco == null) throw new Error('"' + p.nome + '" está sem preço cadastrado.');
        base = n(p.preco);
      }
      const grupos = db.grupos_opcoes.filter(g => g.produto_id === p.id).sort((a, b) => a.ordem - b.ordem);
      const ids = [...new Set((it.opcoes || []).map(Number))];
      const escolhidas = ids.map(id => db.opcoes.find(o => o.id === id && grupos.some(g => g.id === o.grupo_id)));
      if (escolhidas.some(o => !o)) throw new Error('Opções inválidas em "' + p.nome + '". Atualize a página.');
      if (escolhidas.some(o => !o.disponivel)) throw new Error('Um adicional escolhido em "' + p.nome + '" acabou. Escolha outro.');
      grupos.forEach(g => {
        const qtd = escolhidas.filter(o => o.grupo_id === g.id).length;
        if (qtd < n(g.minimo)) throw new Error("Escolha pelo menos " + g.minimo + ' em "' + g.nome + '" (' + p.nome + ").");
        if (g.maximo != null && qtd > n(g.maximo)) throw new Error("Escolha no máximo " + g.maximo + ' em "' + g.nome + '" (' + p.nome + ").");
      });
      const qtd = Number(it.quantidade || 1);
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 99) throw new Error('Quantidade inválida em "' + p.nome + '".');
      const unit = base + escolhidas.reduce((s, o) => s + n(o.preco), 0);
      if (unit <= 0) throw new Error('"' + p.nome + '" está sem preço válido.');
      subtotal += unit * qtd;
      const snap = grupos.flatMap(g => escolhidas.filter(o => o.grupo_id === g.id).sort((a, b) => a.ordem - b.ordem)
        .map(o => ({ grupo: g.nome, nome: o.nome, preco: n(o.preco) })));
      return { produto_id: p.id, nome: p.nome, tamanho: tamNome, opcoes: snap,
               observacao: String(it.observacao || "").trim().slice(0, 200) || null,
               preco_unitario: unit, quantidade: qtd, total: unit * qtd };
    });

    const taxa = tipo === "Delivery" ? n(l.taxa_entrega) : 0;
    if (!manual && subtotal < n(l.pedido_minimo)) throw new Error("O pedido mínimo desta loja é " + reais(l.pedido_minimo) + ".");
    const data = U.hojeNoFuso(l.fuso);
    const chave = l.id + "|" + data;
    db.contador[chave] = (db.contador[chave] || 0) + 1;
    const agora = new Date().toISOString();
    const pedido = {
      id: ++db.seq, loja_id: l.id, numero: db.contador[chave], data_ref: data, cliente_nome: nome,
      telefone: tel || null, tipo_atendimento: tipo, endereco, mesa, pagamento: pag, troco_para: troco,
      observacao: String(ped.observacao || "").trim().slice(0, 300) || null,
      subtotal, taxa_entrega: taxa, total: subtotal + taxa, status: "Recebido", motivo_cancelamento: null,
      origem: manual ? "Manual" : "Cliente",
      tracking_token: (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => (Math.random() * 16 | 0).toString(16))),
      criado_em: agora, atualizado_em: agora
    };
    db.pedidos.push(pedido);
    calculados.forEach(i => db.itens_pedido.push(Object.assign({ id: ++db.seq, pedido_id: pedido.id, loja_id: l.id }, i)));
    gravar("wl_demo_ultimo_token", pedido.tracking_token);
    return { numero: pedido.numero, tracking_token: pedido.tracking_token, subtotal, taxa_entrega: taxa, total: pedido.total };
  }

  function cardapio(db, slug) {
    const l = db.lojas.find(x => x.slug === String(slug || "").trim().toLowerCase());
    if (!l) return null;
    if (!l.ativa) return { loja: { slug: l.slug, nome: l.nome, ativa: false, logo_url: l.logo_url, cor_primaria: l.cor_primaria }, categorias: [], produtos: [] };
    const ord = (a, b) => (a.ordem - b.ordem) || (a.id - b.id);
    const cats = db.categorias.filter(c => c.loja_id === l.id && c.ativa).sort(ord);
    const produtos = db.produtos.filter(p => p.loja_id === l.id && p.ativo &&
      (!p.categoria_id || !db.categorias.some(c => c.id === p.categoria_id) || cats.some(c => c.id === p.categoria_id))).sort(ord)
      .map(p => ({
        id: p.id, categoria_id: p.categoria_id, nome: p.nome, descricao: p.descricao, imagem_url: p.imagem_url,
        preco: p.preco, disponivel: p.disponivel,
        tamanhos: db.produto_tamanhos.filter(t => t.produto_id === p.id).sort(ord).map(t => ({ id: t.id, nome: t.nome, preco: t.preco })),
        grupos: db.grupos_opcoes.filter(g => g.produto_id === p.id).sort(ord).map(g => ({
          id: g.id, nome: g.nome, minimo: g.minimo, maximo: g.maximo,
          opcoes: db.opcoes.filter(o => o.grupo_id === g.id).sort(ord).map(o => ({ id: o.id, nome: o.nome, preco: o.preco, disponivel: o.disponivel }))
        }))
      }));
    const loja = copia(l);
    delete loja.id; delete loja.fuso; delete loja.criado_em;
    return { loja, categorias: cats.map(c => ({ id: c.id, nome: c.nome })), produtos };
  }

  function salvarProduto(db, lojaId, p) {
    if (!podeGerenciar(db, lojaId)) throw new Error("Sem permissão para esta loja.");
    if (p.categoria_id && !db.categorias.some(c => c.id === Number(p.categoria_id) && c.loja_id === lojaId)) throw new Error("Categoria inválida.");
    const tamanhos = p.tamanhos || [], grupos = p.grupos || [];
    if (!tamanhos.length && p.preco == null) throw new Error("Informe o preço do produto ou cadastre tamanhos.");
    let prod;
    if (p.id) {
      prod = db.produtos.find(x => x.id === Number(p.id) && x.loja_id === lojaId);
      if (!prod) throw new Error("Produto não encontrado.");
    } else {
      prod = { id: ++db.seq, loja_id: lojaId, disponivel: true, ordem: 0, criado_em: new Date().toISOString() };
      db.produtos.push(prod);
    }
    Object.assign(prod, {
      categoria_id: p.categoria_id ? Number(p.categoria_id) : null, nome: String(p.nome).trim(),
      descricao: String(p.descricao || "").trim() || null, imagem_url: String(p.imagem_url || "").trim() || null,
      preco: p.preco == null ? null : n(p.preco), ativo: p.ativo !== false
    });

    const manterT = tamanhos.filter(t => t.id).map(t => Number(t.id));
    db.produto_tamanhos = db.produto_tamanhos.filter(t => t.produto_id !== prod.id || manterT.includes(t.id));
    tamanhos.forEach((t, i) => {
      let linha = t.id ? db.produto_tamanhos.find(x => x.id === Number(t.id) && x.produto_id === prod.id) : null;
      if (t.id && !linha) throw new Error("Tamanho inválido.");
      if (!linha) { linha = { id: ++db.seq, produto_id: prod.id, loja_id: lojaId }; db.produto_tamanhos.push(linha); }
      Object.assign(linha, { nome: String(t.nome).trim(), preco: n(t.preco), ordem: i + 1 });
    });

    const manterG = grupos.filter(g => g.id).map(g => Number(g.id));
    const removidosG = db.grupos_opcoes.filter(g => g.produto_id === prod.id && !manterG.includes(g.id)).map(g => g.id);
    db.grupos_opcoes = db.grupos_opcoes.filter(g => !removidosG.includes(g.id));
    db.opcoes = db.opcoes.filter(o => !removidosG.includes(o.grupo_id));
    grupos.forEach((g, gi) => {
      let linha = g.id ? db.grupos_opcoes.find(x => x.id === Number(g.id) && x.produto_id === prod.id) : null;
      if (g.id && !linha) throw new Error("Grupo de opções inválido.");
      if (!linha) { linha = { id: ++db.seq, produto_id: prod.id, loja_id: lojaId }; db.grupos_opcoes.push(linha); }
      Object.assign(linha, { nome: String(g.nome).trim(), minimo: n(g.minimo), maximo: g.maximo == null || g.maximo === "" ? null : n(g.maximo), ordem: gi + 1 });
      const ops = g.opcoes || [];
      const manterO = ops.filter(o => o.id).map(o => Number(o.id));
      db.opcoes = db.opcoes.filter(o => o.grupo_id !== linha.id || manterO.includes(o.id));
      ops.forEach((o, oi) => {
        let lo = o.id ? db.opcoes.find(x => x.id === Number(o.id) && x.grupo_id === linha.id) : null;
        if (o.id && !lo) throw new Error("Opção inválida.");
        if (!lo) { lo = { id: ++db.seq, grupo_id: linha.id, loja_id: lojaId }; db.opcoes.push(lo); }
        Object.assign(lo, { nome: String(o.nome).trim(), preco: n(o.preco), disponivel: o.disponivel !== false, ordem: oi + 1 });
      });
    });
    return prod.id;
  }

  const RPC = {
    is_super_admin: () => !!(usuario() && usuario().superAdmin),
    cardapio_publico: (db, a) => cardapio(db, a.p_slug),
    criar_pedido: (db, a) => criarPedido(db, a.p_slug, a.p_pedido || {}, a.p_itens),
    acompanhar_pedido: (db, a) => {
      const p = db.pedidos.find(x => x.tracking_token === a.p_token);
      if (!p) return null;
      const l = db.lojas.find(x => x.id === p.loja_id);
      return Object.assign(copia(p), {
        itens: db.itens_pedido.filter(i => i.pedido_id === p.id),
        loja: { nome: l.nome, slug: l.slug, whatsapp: l.whatsapp, cor_primaria: l.cor_primaria, logo_url: l.logo_url, chave_pix: l.chave_pix }
      });
    },
    salvar_produto: (db, a) => salvarProduto(db, a.p_loja, a.p),
    master_listar_lojas: db => {
      if (!RPC.is_super_admin()) throw new Error("Acesso restrito à WL Sistemas.");
      const desde = Date.now() - 30 * 864e5;
      return db.lojas.slice().reverse().map(l => {
        const peds = db.pedidos.filter(p => p.loja_id === l.id && p.status !== "Cancelado" && new Date(p.criado_em) > desde);
        return Object.assign(copia(l), {
          membros: db.loja_membros.filter(m => m.loja_id === l.id).map(m => ({ user_id: m.user_id, email: m.email, papel: m.papel })),
          pedidos_30d: peds.length, vendas_30d: peds.reduce((s, p) => s + n(p.total), 0)
        });
      });
    },
    master_criar_loja: (db, a) => {
      if (!RPC.is_super_admin()) throw new Error("Acesso restrito à WL Sistemas.");
      const slug = String(a.p_slug).trim().toLowerCase();
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3) throw new Error("Link inválido.");
      if (db.lojas.some(l => l.slug === slug)) throw new Error('Já existe uma loja com o link "' + slug + '".');
      const l = Object.assign(copia(semente().lojas[0]), {
        id: "loja-" + (++db.seq), slug, nome: String(a.p_nome).trim(), cor_primaria: "#0f766e", whatsapp: null,
        chave_pix: null, endereco: null, taxa_entrega: 0, pedido_minimo: 0, aceita_mesa: false, criado_em: new Date().toISOString()
      });
      db.lojas.push(l);
      return l.id;
    },
    master_atualizar_loja: (db, a) => {
      if (!RPC.is_super_admin()) throw new Error("Acesso restrito à WL Sistemas.");
      const l = db.lojas.find(x => x.id === a.p_loja);
      if (a.p_ativa != null) l.ativa = a.p_ativa;
      if (a.p_slug) {
        if (db.lojas.some(x => x.slug === a.p_slug && x !== l)) throw new Error("Já existe uma loja com esse link.");
        l.slug = a.p_slug;
      }
      return null;
    },
    master_vincular_usuario: (db, a) => {
      if (!RPC.is_super_admin()) throw new Error("Acesso restrito à WL Sistemas.");
      const email = String(a.p_email).trim().toLowerCase();
      const u = USUARIOS[email];
      if (!u) throw new Error("No modo demonstração só existem os usuários dono@demo.com e wl@demo.com.");
      db.loja_membros = db.loja_membros.filter(m => !(m.loja_id === a.p_loja && m.user_id === u.id));
      db.loja_membros.push({ loja_id: a.p_loja, user_id: u.id, papel: a.p_papel || "dono", email });
      return null;
    },
    master_remover_usuario: (db, a) => {
      if (!RPC.is_super_admin()) throw new Error("Acesso restrito à WL Sistemas.");
      db.loja_membros = db.loja_membros.filter(m => !(m.loja_id === a.p_loja && m.user_id === a.p_user));
      return null;
    }
  };
  const SO_LEITURA = ["is_super_admin", "cardapio_publico", "acompanhar_pedido", "master_listar_lojas"];

  window.WL = {
    demo: true,
    configurado: () => true,
    logado: () => !!usuario(),
    usuario: () => usuario() ? { id: usuario().id, email: usuario().email } : null,
    async entrar(email, senha) {
      await espera();
      const e = String(email).trim().toLowerCase();
      const u = USUARIOS[e];
      if (!u || u.senha !== senha) throw new Error("E-mail ou senha incorretos. No modo demonstração use dono@demo.com ou wl@demo.com, senha 123456.");
      sessao = { email: e };
      gravar(CHAVE_SESSAO, sessao);
      return { id: u.id, email: e };
    },
    async sair() { sessao = null; try { localStorage.removeItem(CHAVE_SESSAO); } catch (e) { /* ignorar */ } },
    async garantirSessao() { return !!usuario(); },

    async rpc(fn, args) {
      await espera();
      if (!RPC[fn]) throw new Error("Função indisponível no modo demonstração.");
      const db = carregarDb();
      const r = RPC[fn](db, args || {});
      if (!SO_LEITURA.includes(fn)) salvarDb(db);
      return copia(r === undefined ? null : r);
    },
    async listar(tabela, params) {
      await espera();
      exigirLogin();
      return copia(filtrar(tabelaVisivel(carregarDb(), tabela), params));
    },
    async inserir(tabela, dados) {
      await espera();
      exigirLogin();
      const db = carregarDb();
      const linhas = (Array.isArray(dados) ? dados : [dados]).map(d => {
        if (!podeGerenciar(db, d.loja_id)) throw new Error("Sem permissão para esta ação.");
        const l = Object.assign({ id: ++db.seq, ordem: 0, ativa: true }, d);
        db[tabela].push(l);
        return l;
      });
      salvarDb(db);
      return copia(linhas);
    },
    async atualizar(tabela, filtros, dados) {
      await espera();
      exigirLogin();
      const db = carregarDb();
      const alvo = filtrar(tabelaVisivel(db, tabela), filtros);
      alvo.forEach(l => {
        Object.assign(l, dados);
        if (tabela === "pedidos") {
          l.atualizado_em = new Date().toISOString();
          if (l.status !== "Cancelado") l.motivo_cancelamento = null;
        }
      });
      salvarDb(db);
      return copia(alvo);
    },
    async excluir(tabela, filtros) {
      await espera();
      exigirLogin();
      const db = carregarDb();
      let alvo = filtrar(tabelaVisivel(db, tabela), filtros);
      if (tabela === "pedidos") alvo = alvo.filter(p => p.status === "Cancelado");
      const ids = alvo.map(x => x.id);
      db[tabela] = db[tabela].filter(x => !ids.includes(x.id));
      if (tabela === "categorias") db.produtos.forEach(p => { if (ids.includes(p.categoria_id)) p.categoria_id = null; });
      if (tabela === "produtos") {
        const grupos = db.grupos_opcoes.filter(g => ids.includes(g.produto_id)).map(g => g.id);
        db.produto_tamanhos = db.produto_tamanhos.filter(t => !ids.includes(t.produto_id));
        db.grupos_opcoes = db.grupos_opcoes.filter(g => !grupos.includes(g.id));
        db.opcoes = db.opcoes.filter(o => !grupos.includes(o.grupo_id));
      }
      if (tabela === "pedidos") db.itens_pedido = db.itens_pedido.filter(i => !ids.includes(i.pedido_id));
      salvarDb(db);
      return copia(alvo);
    },
    enviarImagem(caminho, arquivo) {
      return new Promise((ok, falha) => {
        const r = new FileReader();
        r.onload = () => ok(r.result);
        r.onerror = () => falha(new Error("Não foi possível ler a imagem."));
        r.readAsDataURL(arquivo);
      });
    },
    resetarDemo() {
      try { localStorage.removeItem(CHAVE_DB); localStorage.removeItem(CHAVE_SESSAO); } catch (e) { /* ignorar */ }
      memoria = null;
      location.reload();
    }
  };

  // Faixa de aviso
  document.addEventListener("DOMContentLoaded", () => {
    const faixa = document.createElement("div");
    faixa.className = "faixa-demo";
    faixa.innerHTML = 'Modo demonstração: os dados ficam só neste aparelho. <button type="button">Recomeçar do zero</button>';
    faixa.querySelector("button").onclick = async () => {
      if (await U.confirmar("Apagar pedidos e alterações da demonstração e voltar ao início?", "Recomeçar", true)) window.WL.resetarDemo();
    };
    document.body.prepend(faixa);
  });
})();
