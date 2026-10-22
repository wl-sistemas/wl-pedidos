// =====================================================================
// WL PEDIDOS - CARDAPIO DO CLIENTE
// Link: cardapio.html?loja=<link-da-loja>
// Modo balcao (loja lancando pedido): cardapio.html?loja=<link>&balcao=1
// =====================================================================
(function () {
  const { $, $$, esc, moeda } = U;

  const slug = (U.param("loja") || (WL.demo ? "demo" : "")).toLowerCase().trim();
  const balcao = U.param("balcao") === "1" && WL.logado();
  const CHAVE_CARRINHO = "wl_carrinho_" + slug;
  const CHAVE_CLIENTE = "wl_cliente";

  let loja = null;
  let categorias = [];
  let produtos = [];
  const produtoPorId = {};
  let carrinho = [];
  let tipo = null;
  let pagamento = null;
  let atual = null; // produto aberto na folha

  // ------------------------------------------------------------------
  // Inicio
  // ------------------------------------------------------------------
  async function iniciar() {
    if (!WL.configurado()) {
      return erroTela("Sistema não configurado", "Preencha o arquivo config.js com os dados do Supabase.");
    }
    if (!slug) {
      return erroTela("Cardápio não encontrado", "O link está incompleto. Peça o link certo para a loja.");
    }
    let dados;
    try {
      dados = await WL.rpc("cardapio_publico", { p_slug: slug });
    } catch (e) {
      return erroTela("Não foi possível abrir o cardápio", e.message);
    }
    if (!dados || !dados.loja) {
      return erroTela("Cardápio não encontrado", "Confira o link com a loja.");
    }
    loja = dados.loja;
    U.aplicarCor(loja.cor_primaria);
    document.title = loja.nome + " | Cardápio";
    if (!loja.ativa) {
      return erroTela(loja.nome, "Este cardápio está indisponível no momento.");
    }

    categorias = dados.categorias || [];
    produtos = dados.produtos || [];
    produtos.forEach(p => { produtoPorId[p.id] = p; });

    carregarCarrinho();
    montarTopo();
    montarProdutos();
    prepararFolhas();
    prepararFormulario();
    atualizarBarra();

    $("#carregando").classList.add("oculto");
    $("#app").classList.remove("oculto");
  }

  function erroTela(titulo, texto) {
    $("#carregando").classList.add("oculto");
    $("#erroTitulo").textContent = titulo;
    $("#erroTexto").textContent = texto;
    $("#erroTela").classList.remove("oculto");
  }

  function lojaFechada() {
    return !loja.aberta && !balcao;
  }

  // ------------------------------------------------------------------
  // Topo da loja
  // ------------------------------------------------------------------
  function montarTopo() {
    $("#lojaNome").textContent = loja.nome;
    $("#lojaInicial").textContent = loja.nome.trim().charAt(0).toUpperCase();
    if (loja.logo_url) {
      const img = $("#lojaLogo");
      img.src = loja.logo_url;
      img.alt = "Logo " + loja.nome;
      img.classList.remove("oculto");
      $("#lojaInicial").classList.add("oculto");
      img.onerror = () => { img.classList.add("oculto"); $("#lojaInicial").classList.remove("oculto"); };
    }

    const status = $("#lojaStatus");
    status.textContent = loja.aberta ? "Aberto agora" : "Fechado no momento";
    status.classList.toggle("fechada", !loja.aberta);

    const infos = [];
    if (loja.aceita_delivery) {
      infos.push(Number(loja.taxa_entrega) > 0
        ? "Entrega <strong>" + moeda(loja.taxa_entrega) + "</strong>"
        : "Entrega <strong>grátis</strong>");
    }
    if (loja.aceita_retirada) infos.push("Retirada no local");
    if (loja.aceita_mesa) infos.push("Pedido na mesa");
    if (Number(loja.pedido_minimo) > 0) infos.push("Pedido mínimo <strong>" + moeda(loja.pedido_minimo) + "</strong>");
    $("#lojaInfos").innerHTML = infos.map(i => "<li>" + i + "</li>").join("");

    if (lojaFechada()) {
      const aviso = $("#avisoFechada");
      aviso.textContent = loja.mensagem_fechada || "A loja está fechada agora. Você pode ver o cardápio, mas os pedidos voltam quando ela abrir.";
      aviso.classList.remove("oculto");
    }

    if (balcao) {
      $("#faixaBalcao").classList.remove("oculto");
      $("#voltarPainel").href = "painel.html";
    }

    const C = window.WL_CONFIG || {};
    $("#rodapeWL").textContent = "Cardápio digital feito com " + (C.nomeSistema || "WL Pedidos");
    $("#rodapeWL").href = U.linkWhatsapp(C.suporteWhatsapp,
      "Olá! Vi o cardápio digital da " + loja.nome + " e quero um para a minha loja.");
  }

  // ------------------------------------------------------------------
  // Lista de produtos
  // ------------------------------------------------------------------
  function precoMinimo(p) {
    if (p.tamanhos.length) return Math.min.apply(null, p.tamanhos.map(t => Number(t.preco)));
    return Number(p.preco || 0);
  }

  function montarProdutos() {
    const grupos = categorias.map(c => ({ id: "cat-" + c.id, nome: c.nome, itens: produtos.filter(p => p.categoria_id === c.id) }));
    const semCategoria = produtos.filter(p => !p.categoria_id || !categorias.some(c => c.id === p.categoria_id));
    if (semCategoria.length) grupos.push({ id: "cat-outros", nome: grupos.length ? "Outros" : "Cardápio", itens: semCategoria });
    const visiveis = grupos.filter(g => g.itens.length);

    if (!visiveis.length) {
      $("#secoes").innerHTML = '<p class="vazio">O cardápio ainda está sendo montado. Volte em breve.</p>';
      $("#categoriasNav").classList.add("oculto");
      return;
    }

    $("#categoriasNav").innerHTML = visiveis.map((g, i) =>
      `<a href="#${g.id}" class="${i === 0 ? "ativa" : ""}">${esc(g.nome)}</a>`).join("");
    if (visiveis.length < 2) $("#categoriasNav").classList.add("oculto");

    $("#secoes").innerHTML = visiveis.map(g => `
      <section class="secao" id="${g.id}">
        <h2>${esc(g.nome)}</h2>
        ${g.itens.map(cartaoProduto).join("")}
      </section>`).join("");

    $$(".produto").forEach(b => b.addEventListener("click", () => abrirProduto(Number(b.dataset.id))));
    prepararBusca(visiveis.length > 1 || produtos.length > 6);

    // Destaca a categoria visivel no menu
    if ("IntersectionObserver" in window && visiveis.length > 1) {
      const links = $$("#categoriasNav a");
      const obs = new IntersectionObserver(entradas => {
        entradas.forEach(e => {
          if (!e.isIntersecting) return;
          links.forEach(a => {
            const ativo = a.getAttribute("href") === "#" + e.target.id;
            a.classList.toggle("ativa", ativo);
            if (ativo) a.scrollIntoView({ block: "nearest", inline: "center" });
          });
        });
      }, { rootMargin: "-40% 0px -55% 0px" });
      $$(".secao").forEach(s => obs.observe(s));
    }
  }

  // ------------------------------------------------------------------
  // Busca no cardapio (ignora acentos e maiusculas)
  // ------------------------------------------------------------------
  function normalizar(t) {
    return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function prepararBusca(mostrar) {
    $("#buscaCaixa").classList.toggle("oculto", !mostrar);
    if (!mostrar) return;
    const campo = $("#buscaTexto");
    campo.oninput = () => filtrarCardapio(campo.value);
    campo.onkeydown = e => { if (e.key === "Enter") campo.blur(); if (e.key === "Escape") { campo.value = ""; filtrarCardapio(""); } };
    $("#buscaLimpar").onclick = () => { campo.value = ""; filtrarCardapio(""); campo.focus(); };
  }

  function filtrarCardapio(texto) {
    const termos = normalizar(texto).split(" ").filter(Boolean);
    $("#buscaLimpar").classList.toggle("oculto", !termos.length);
    let achados = 0;
    $$(".secao").forEach(sec => {
      let naSecao = 0;
      sec.querySelectorAll(".produto").forEach(b => {
        const ok = termos.every(t => b.dataset.busca.includes(t));
        b.classList.toggle("oculto", !ok);
        if (ok) naSecao++;
      });
      sec.classList.toggle("oculto", !naSecao);
      sec.classList.toggle("secao-filtrada", termos.length > 0);
      const link = $('#categoriasNav a[href="#' + sec.id + '"]');
      if (link) link.classList.toggle("oculto", !naSecao);
      achados += naSecao;
    });
    const vazio = $("#buscaVazia");
    vazio.textContent = 'Nada encontrado para "' + texto.trim() + '". Tente outra palavra.';
    vazio.classList.toggle("oculto", !termos.length || achados > 0);
  }

  function cartaoProduto(p) {
    const preco = p.tamanhos.length
      ? "<small>a partir de</small> " + moeda(precoMinimo(p))
      : moeda(p.preco);
    return `
      <button class="produto" type="button" data-id="${p.id}" data-busca="${esc(normalizar(p.nome + " " + (p.descricao || "")))}" ${p.disponivel ? "" : "disabled"}>
        <span class="produto-texto">
          <strong>${esc(p.nome)}</strong>
          ${p.descricao ? `<p>${esc(p.descricao)}</p>` : ""}
          ${p.disponivel ? `<span class="produto-preco">${preco}</span>` : '<span class="selo-esgotado">Esgotado</span>'}
        </span>
        ${p.imagem_url ? `<img class="produto-foto" src="${esc(p.imagem_url)}" alt="" loading="lazy">` : ""}
      </button>`;
  }

  // ------------------------------------------------------------------
  // Folha do produto (tamanho, opcoes, quantidade)
  // ------------------------------------------------------------------
  function regraGrupo(g) {
    const min = Number(g.minimo || 0), max = g.maximo == null ? null : Number(g.maximo);
    if (min === 0 && max === null) return "Opcional";
    if (min === 0 && max === 1) return "Opcional, escolha 1";
    if (min === 0) return "Opcional, até " + max;
    if (max === null) return "Escolha pelo menos " + min;
    if (min === max) return "Obrigatório, escolha " + min;
    return "Escolha de " + min + " a " + max;
  }

  function abrirProduto(id) {
    const p = produtoPorId[id];
    if (!p || !p.disponivel) return;
    atual = { p, tamanhoId: null, selecionadas: new Set(), qtd: 1 };

    const img = $("#produtoImagem");
    if (p.imagem_url) {
      img.style.backgroundImage = `url("${p.imagem_url.replace(/"/g, "%22")}")`;
      img.classList.remove("oculto");
    } else {
      img.classList.add("oculto");
    }
    $("#produtoNome").textContent = p.nome;
    $("#produtoDescricao").textContent = p.descricao || "";
    $("#produtoObs").value = "";
    $("#qtdValor").textContent = "1";

    let html = "";
    if (p.tamanhos.length) {
      html += `
        <div class="grupo" data-grupo="tamanho">
          <div class="grupo-cabeca"><h3>Tamanho</h3><span class="grupo-regra obrigatorio">Obrigatório, escolha 1</span></div>
          <div class="opcoes unica">
            ${p.tamanhos.map(t => `
              <button type="button" class="opcao" data-tamanho="${t.id}" aria-pressed="false">
                <span class="opcao-marca"></span>
                <span class="opcao-nome">${esc(t.nome)}</span>
                <span class="opcao-preco">${moeda(t.preco)}</span>
              </button>`).join("")}
          </div>
        </div>`;
    }
    p.grupos.forEach(g => {
      if (!g.opcoes.length) return;
      const unica = Number(g.maximo) === 1;
      html += `
        <div class="grupo" data-grupo="${g.id}">
          <div class="grupo-cabeca"><h3>${esc(g.nome)}</h3>
            <span class="grupo-regra ${Number(g.minimo) > 0 ? "obrigatorio" : ""}">${regraGrupo(g)}</span></div>
          <div class="opcoes ${unica ? "unica" : ""}">
            ${g.opcoes.map(o => `
              <button type="button" class="opcao" data-opcao="${o.id}" data-g="${g.id}" aria-pressed="false" ${o.disponivel ? "" : "disabled"}>
                <span class="opcao-marca"></span>
                <span class="opcao-nome">${esc(o.nome)}${o.disponivel ? "" : " (acabou)"}</span>
                <span class="opcao-preco">${Number(o.preco) > 0 ? "+ " + moeda(o.preco) : ""}</span>
              </button>`).join("")}
          </div>
        </div>`;
    });
    $("#produtoOpcoes").innerHTML = html;

    $$("#produtoOpcoes [data-tamanho]").forEach(b => b.addEventListener("click", () => {
      atual.tamanhoId = Number(b.dataset.tamanho);
      $$("#produtoOpcoes [data-tamanho]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      b.closest(".grupo").classList.remove("falta");
      atualizarTotalProduto();
    }));
    $$("#produtoOpcoes [data-opcao]").forEach(b => b.addEventListener("click", () => alternarOpcao(b)));

    // Um tamanho so: ja vem marcado
    if (p.tamanhos.length === 1) $("#produtoOpcoes [data-tamanho]").click();
    atualizarTotalProduto();
    abrirFolha("#folhaProduto");
  }

  function alternarOpcao(botao) {
    const id = Number(botao.dataset.opcao);
    const g = atual.p.grupos.find(x => x.id === Number(botao.dataset.g));
    const max = g.maximo == null ? null : Number(g.maximo);
    const doGrupo = g.opcoes.map(o => o.id);

    if (atual.selecionadas.has(id)) {
      atual.selecionadas.delete(id);
    } else if (max === 1) {
      doGrupo.forEach(o => atual.selecionadas.delete(o));
      atual.selecionadas.add(id);
    } else {
      const qtd = doGrupo.filter(o => atual.selecionadas.has(o)).length;
      if (max !== null && qtd >= max) {
        U.toast("Você pode escolher até " + max + " em " + g.nome + ".");
        return;
      }
      atual.selecionadas.add(id);
    }
    $$(`#produtoOpcoes [data-g="${g.id}"]`).forEach(b =>
      b.setAttribute("aria-pressed", String(atual.selecionadas.has(Number(b.dataset.opcao)))));
    botao.closest(".grupo").classList.remove("falta");
    atualizarTotalProduto();
  }

  function precoUnitario(p, tamanhoId, opcoesIds) {
    let base;
    if (p.tamanhos.length) {
      const t = p.tamanhos.find(x => x.id === tamanhoId);
      base = t ? Number(t.preco) : precoMinimo(p);
    } else {
      base = Number(p.preco || 0);
    }
    let extras = 0;
    p.grupos.forEach(g => g.opcoes.forEach(o => { if (opcoesIds.includes(o.id)) extras += Number(o.preco); }));
    return base + extras;
  }

  function atualizarTotalProduto() {
    const unit = precoUnitario(atual.p, atual.tamanhoId, Array.from(atual.selecionadas));
    $("#produtoTotal").textContent = moeda(unit * atual.qtd);
  }

  function validarProduto() {
    const p = atual.p;
    if (p.tamanhos.length && !atual.tamanhoId) return $('#produtoOpcoes [data-grupo="tamanho"]');
    for (const g of p.grupos) {
      if (!g.opcoes.length) continue;
      const qtd = g.opcoes.filter(o => atual.selecionadas.has(o.id)).length;
      if (qtd < Number(g.minimo || 0)) return $(`#produtoOpcoes [data-grupo="${g.id}"]`);
    }
    return null;
  }

  function adicionarAoCarrinho() {
    const falta = validarProduto();
    if (falta) {
      falta.classList.remove("falta");
      void falta.offsetWidth;
      falta.classList.add("falta");
      falta.scrollIntoView({ behavior: "smooth", block: "center" });
      U.toast("Escolha as opções obrigatórias.");
      return;
    }
    const item = {
      produto_id: atual.p.id,
      tamanho_id: atual.tamanhoId,
      opcoes: Array.from(atual.selecionadas).sort((a, b) => a - b),
      quantidade: atual.qtd,
      observacao: $("#produtoObs").value.trim().slice(0, 200)
    };
    const igual = carrinho.find(i => i.produto_id === item.produto_id && i.tamanho_id === item.tamanho_id &&
      i.observacao === item.observacao && i.opcoes.join() === item.opcoes.join());
    if (igual) igual.quantidade = Math.min(99, igual.quantidade + item.quantidade);
    else carrinho.push(item);

    salvarCarrinho();
    fecharFolha("#folhaProduto");
    atualizarBarra(true);
    U.toast(atual.p.nome + " adicionado");
  }

  // ------------------------------------------------------------------
  // Carrinho
  // ------------------------------------------------------------------
  function carregarCarrinho() {
    const salvo = U.lerLocal(CHAVE_CARRINHO, null);
    if (!salvo || !Array.isArray(salvo.itens) || Date.now() - (salvo.em || 0) > 12 * 3600 * 1000) {
      carrinho = [];
      return;
    }
    const antes = salvo.itens.length;
    carrinho = salvo.itens.filter(itemValido);
    if (carrinho.length !== antes) {
      salvarCarrinho();
      setTimeout(() => U.toast("Alguns itens saíram do carrinho porque o cardápio mudou."), 400);
    }
  }

  function itemValido(i) {
    const p = produtoPorId[i.produto_id];
    if (!p || !p.disponivel) return false;
    if (p.tamanhos.length && !p.tamanhos.some(t => t.id === i.tamanho_id)) return false;
    const todas = {};
    p.grupos.forEach(g => g.opcoes.forEach(o => { todas[o.id] = o; }));
    if (!Array.isArray(i.opcoes) || i.opcoes.some(id => !todas[id] || !todas[id].disponivel)) return false;
    return p.grupos.every(g => {
      const qtd = g.opcoes.filter(o => i.opcoes.includes(o.id)).length;
      return qtd >= Number(g.minimo || 0) && (g.maximo == null || qtd <= Number(g.maximo));
    });
  }

  function salvarCarrinho() {
    U.gravarLocal(CHAVE_CARRINHO, { em: Date.now(), itens: carrinho });
  }

  function descreverItem(i) {
    const p = produtoPorId[i.produto_id];
    const partes = [];
    if (i.tamanho_id) {
      const t = p.tamanhos.find(x => x.id === i.tamanho_id);
      if (t) partes.push(t.nome);
    }
    const escolhidas = [];
    p.grupos.forEach(g => g.opcoes.forEach(o => {
      if (i.opcoes.includes(o.id)) escolhidas.push({ grupo: g.nome, nome: o.nome });
    }));
    const resumo = U.resumoOpcoes(escolhidas);
    if (resumo) partes.push(resumo);
    if (i.observacao) partes.push("Obs: " + i.observacao);
    return partes;
  }

  function subtotal() {
    return carrinho.reduce((s, i) => s + precoUnitario(produtoPorId[i.produto_id], i.tamanho_id, i.opcoes) * i.quantidade, 0);
  }
  function taxa() {
    return tipo === "Delivery" ? Number(loja.taxa_entrega || 0) : 0;
  }

  function atualizarBarra(animar) {
    const qtd = carrinho.reduce((s, i) => s + i.quantidade, 0);
    const barra = $("#barraCarrinho");
    barra.classList.toggle("oculto", qtd === 0);
    $("#barraQtd").textContent = qtd;
    $("#barraTotal").textContent = moeda(subtotal());
    if (animar) {
      barra.classList.remove("pulo");
      void barra.offsetWidth;
      barra.classList.add("pulo");
    }
  }

  function montarPedido() {
    if (!carrinho.length) {
      fecharFolha("#folhaPedido");
      return;
    }
    $("#listaItens").innerHTML = carrinho.map((i, idx) => {
      const p = produtoPorId[i.produto_id];
      const unit = precoUnitario(p, i.tamanho_id, i.opcoes);
      return `
        <li class="item">
          <span class="item-nome">${i.quantidade}x ${esc(p.nome)}</span>
          <span>${moeda(unit * i.quantidade)}</span>
          ${descreverItem(i).map(d => `<span class="item-detalhe">${esc(d)}</span>`).join("")}
          <div class="item-acoes">
            <div class="contador">
              <button type="button" data-menos="${idx}" aria-label="Diminuir">−</button>
              <output>${i.quantidade}</output>
              <button type="button" data-mais="${idx}" aria-label="Aumentar">+</button>
            </div>
            <button type="button" class="btn btn-texto" data-remover="${idx}">Remover</button>
          </div>
        </li>`;
    }).join("");

    $$("[data-menos]").forEach(b => b.onclick = () => mudarQtd(Number(b.dataset.menos), -1));
    $$("[data-mais]").forEach(b => b.onclick = () => mudarQtd(Number(b.dataset.mais), 1));
    $$("[data-remover]").forEach(b => b.onclick = () => { carrinho.splice(Number(b.dataset.remover), 1); depoisDeMudar(); });

    atualizarValores();
  }

  function mudarQtd(idx, delta) {
    const i = carrinho[idx];
    i.quantidade = Math.max(0, Math.min(99, i.quantidade + delta));
    if (i.quantidade === 0) carrinho.splice(idx, 1);
    depoisDeMudar();
  }

  function depoisDeMudar() {
    salvarCarrinho();
    atualizarBarra();
    montarPedido();
  }

  function atualizarValores() {
    const sub = subtotal();
    $("#valSubtotal").textContent = moeda(sub);
    $("#linhaTaxa").classList.toggle("oculto", tipo !== "Delivery");
    $("#valTaxa").textContent = Number(loja.taxa_entrega) > 0 ? moeda(taxa()) : "Grátis";
    $("#valTotal").textContent = moeda(sub + taxa());

    const minimo = Number(loja.pedido_minimo || 0);
    const aviso = $("#avisoMinimo");
    const abaixo = !balcao && minimo > 0 && sub < minimo;
    aviso.classList.toggle("oculto", !abaixo);
    if (abaixo) aviso.textContent = "O pedido mínimo é " + moeda(minimo) + ". Faltam " + moeda(minimo - sub) + ".";

    const btn = $("#btnEnviar");
    if (lojaFechada()) {
      btn.disabled = true;
      btn.textContent = "Loja fechada no momento";
    } else {
      btn.disabled = abaixo;
      btn.textContent = balcao ? "Lançar pedido" : "Enviar pedido";
    }
  }

  // ------------------------------------------------------------------
  // Formulario de finalizacao
  // ------------------------------------------------------------------
  function prepararFormulario() {
    const tipos = [];
    if (balcao || loja.aceita_delivery) tipos.push(["Delivery", "Entrega"]);
    if (balcao || loja.aceita_retirada) tipos.push(["Retirada", "Retirar"]);
    if (balcao || loja.aceita_mesa) tipos.push(["Mesa", "Na mesa"]);
    if (!tipos.length) tipos.push(["Retirada", "Retirar"]);

    const salvo = balcao ? {} : U.lerLocal(CHAVE_CLIENTE, {});
    tipo = tipos.some(t => t[0] === salvo.tipo) ? salvo.tipo : tipos[0][0];
    if (balcao && tipos.some(t => t[0] === "Mesa")) tipo = "Mesa";

    $("#tiposAtendimento").innerHTML = tipos.map(([v, rotulo]) => `
      <label><input type="radio" name="tipo" value="${v}" ${v === tipo ? "checked" : ""}><span>${rotulo}</span></label>`).join("");
    $$('#tiposAtendimento input').forEach(r => r.addEventListener("change", () => { tipo = r.value; ajustarCampos(); atualizarValores(); }));
    if (tipos.length === 1) $("#tiposAtendimento").closest("fieldset").classList.add("oculto");

    const formas = Array.isArray(loja.formas_pagamento) ? loja.formas_pagamento : [];
    if (!formas.length) {
      $("#blocoPagamento").classList.add("oculto");
    } else {
      pagamento = formas.includes(salvo.pagamento) ? salvo.pagamento : formas[0];
      $("#formasPagamento").innerHTML = formas.map(f => `
        <label><input type="radio" name="pagamento" value="${esc(f)}" ${f === pagamento ? "checked" : ""}><span>${esc(f)}</span></label>`).join("");
      $$('#formasPagamento input').forEach(r => r.addEventListener("change", () => { pagamento = r.value; ajustarCampos(); }));
    }

    if (!balcao) {
      $("#cNome").value = salvo.nome || "";
      $("#cTelefone").value = salvo.telefone || "";
      $("#cEndereco").value = salvo.endereco || "";
    } else {
      $("#campoTelefone span").textContent = "WhatsApp do cliente (opcional)";
      $("#cNome").placeholder = "Nome do cliente";
    }

    $("#formPedido").addEventListener("submit", e => { e.preventDefault(); enviarPedido(); });
    ajustarCampos();
  }

  function ajustarCampos() {
    $("#campoEndereco").classList.toggle("oculto", tipo !== "Delivery");
    $("#campoMesa").classList.toggle("oculto", tipo !== "Mesa");
    $("#campoTroco").classList.toggle("oculto", pagamento !== "Dinheiro");
  }

  function mostrarErro(msg) {
    const box = $("#erroPedido");
    box.textContent = msg;
    box.classList.remove("oculto");
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function enviarPedido() {
    $("#erroPedido").classList.add("oculto");
    const nome = $("#cNome").value.trim();
    const telefone = $("#cTelefone").value.trim();
    const endereco = $("#cEndereco").value.trim();
    const mesa = $("#cMesa").value.trim();
    const obs = $("#cObs").value.trim();
    let troco = null;

    if (!carrinho.length) return mostrarErro("Seu carrinho está vazio.");
    if (!nome) return mostrarErro(balcao ? "Informe o nome do cliente." : "Informe seu nome.");
    if (!balcao && telefone.replace(/\D/g, "").length < 10) return mostrarErro("Informe seu WhatsApp com DDD.");
    if (tipo === "Delivery" && endereco.length < 5) return mostrarErro("Informe o endereço de entrega.");
    if (tipo === "Mesa" && !mesa) return mostrarErro("Informe a mesa ou comanda.");
    if (pagamento === "Dinheiro" && $("#cTroco").value.trim()) {
      troco = U.numero($("#cTroco").value);
      if (!Number.isFinite(troco) || troco <= 0) return mostrarErro("Informe um valor de troco válido, ex.: 50");
      if (troco < subtotal() + taxa()) return mostrarErro("O troco precisa ser maior que o total do pedido.");
    }

    const pedido = {
      cliente_nome: nome, telefone, tipo_atendimento: tipo,
      endereco: tipo === "Delivery" ? endereco : "",
      mesa: tipo === "Mesa" ? mesa : "",
      pagamento, troco_para: troco, observacao: obs,
      origem: balcao ? "Manual" : "Cliente"
    };
    const itens = carrinho.map(i => ({
      produto_id: i.produto_id, tamanho_id: i.tamanho_id, opcoes: i.opcoes,
      quantidade: i.quantidade, observacao: i.observacao
    }));
    const resumoItens = carrinho.map(i => ({
      texto: i.quantidade + "x " + produtoPorId[i.produto_id].nome,
      detalhes: descreverItem(i),
      valor: precoUnitario(produtoPorId[i.produto_id], i.tamanho_id, i.opcoes) * i.quantidade
    }));

    await U.ocupado($("#btnEnviar"), "Enviando…", async () => {
      try {
        const r = await WL.rpc("criar_pedido", { p_slug: slug, p_pedido: pedido, p_itens: itens });
        if (!balcao) {
          U.gravarLocal(CHAVE_CLIENTE, { nome, telefone, endereco, tipo, pagamento });
        }
        carrinho = [];
        salvarCarrinho();
        atualizarBarra();
        $("#cObs").value = "";
        $("#cTroco").value = "";
        if (balcao) { $("#cNome").value = ""; $("#cTelefone").value = ""; $("#cEndereco").value = ""; $("#cMesa").value = ""; }
        fecharFolha("#folhaPedido");
        mostrarConfirmacao(r, pedido, resumoItens);
      } catch (e) {
        mostrarErro(e.message);
      }
    });
  }

  // ------------------------------------------------------------------
  // Confirmacao
  // ------------------------------------------------------------------
  function mostrarConfirmacao(r, pedido, resumoItens) {
    const linkAcomp = new URL("acompanhar.html?t=" + r.tracking_token, location.href).href;
    $("#confNumero").textContent = "#" + r.numero;
    $("#confTotal").textContent = moeda(r.total);
    $("#confAcompanhar").href = linkAcomp;
    $("#confTitulo").textContent = balcao ? "Pedido lançado no painel." : "A loja já recebeu seu pedido.";

    const temPix = !balcao && pedido.pagamento === "Pix" && loja.chave_pix;
    $("#confPix").classList.toggle("oculto", !temPix);
    if (temPix) $("#confPixChave").textContent = loja.chave_pix;

    const linhas = [];
    linhas.push("*Pedido #" + r.numero + "* - " + loja.nome);
    linhas.push("Cliente: " + pedido.cliente_nome);
    if (pedido.tipo_atendimento === "Delivery") linhas.push("Entrega: " + pedido.endereco);
    else if (pedido.tipo_atendimento === "Mesa") linhas.push("Mesa: " + pedido.mesa);
    else linhas.push("Retirada no local");
    linhas.push("");
    resumoItens.forEach(i => {
      linhas.push(i.texto + " - " + moeda(i.valor));
      i.detalhes.forEach(d => linhas.push("   " + d));
    });
    linhas.push("");
    if (Number(r.taxa_entrega) > 0) linhas.push("Taxa de entrega: " + moeda(r.taxa_entrega));
    linhas.push("*Total: " + moeda(r.total) + "*");
    if (pedido.pagamento) {
      linhas.push("Pagamento: " + pedido.pagamento + (pedido.troco_para ? " (troco para " + moeda(pedido.troco_para) + ")" : ""));
    }
    if (pedido.observacao) linhas.push("Obs: " + pedido.observacao);
    linhas.push("");
    linhas.push("Acompanhar: " + linkAcomp);

    const zap = $("#confWhatsapp");
    zap.href = U.linkWhatsapp(loja.whatsapp, linhas.join("\n"));
    zap.classList.toggle("oculto", balcao || !loja.whatsapp);
    $("#confAcompanhar").classList.toggle("oculto", balcao);
    $("#confNovo").textContent = balcao ? "Lançar outro pedido" : "Fazer outro pedido";
    $("#confNovo").className = balcao ? "btn btn-cor btn-bloco" : "btn btn-texto btn-bloco";

    $("#telaConfirmado").classList.remove("oculto");
    travarRolagem();
    (balcao ? $("#confNovo") : $("#confAcompanhar")).focus();
  }

  // ------------------------------------------------------------------
  // Folhas (abrir/fechar)
  // ------------------------------------------------------------------
  let folhaAberta = null;
  let focoAntes = null;

  // Trava a pagina de tras enquanto uma janela esta aberta.
  // No iPhone so "overflow: hidden" nao basta: fixamos o body e guardamos a posicao.
  let travas = 0;
  let rolagemSalva = 0;
  function travarRolagem() {
    if (travas++ > 0) return;
    rolagemSalva = window.scrollY || window.pageYOffset || 0;
    const s = document.body.style;
    s.position = "fixed"; s.top = -rolagemSalva + "px"; s.left = "0"; s.right = "0"; s.width = "100%"; s.overflow = "hidden";
  }
  function liberarRolagem() {
    if (travas === 0 || --travas > 0) return;
    const s = document.body.style;
    s.position = ""; s.top = ""; s.left = ""; s.right = ""; s.width = ""; s.overflow = "";
    window.scrollTo(0, rolagemSalva);
  }

  function abrirFolha(sel) {
    focoAntes = document.activeElement;
    folhaAberta = $(sel);
    if (folhaAberta.classList.contains("oculto")) travarRolagem();
    folhaAberta.classList.remove("oculto");
    const corpo = folhaAberta.querySelector(".folha-corpo");
    if (corpo) corpo.scrollTop = 0;
    folhaAberta.querySelector(".folha-fechar").focus();
  }
  function fecharFolha(sel) {
    const f = $(sel);
    const estavaAberta = !f.classList.contains("oculto");
    f.classList.add("oculto");
    if (folhaAberta === f) folhaAberta = null;
    if (estavaAberta) liberarRolagem();
    if (focoAntes && document.contains(focoAntes)) focoAntes.focus();
  }

  function prepararFolhas() {
    $$("[data-fechar]").forEach(el => el.addEventListener("click", () => fecharFolha("#" + el.closest(".folha").id)));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && folhaAberta) fecharFolha("#" + folhaAberta.id); });

    $("#qtdMenos").onclick = () => { atual.qtd = Math.max(1, atual.qtd - 1); $("#qtdValor").textContent = atual.qtd; atualizarTotalProduto(); };
    $("#qtdMais").onclick = () => { atual.qtd = Math.min(99, atual.qtd + 1); $("#qtdValor").textContent = atual.qtd; atualizarTotalProduto(); };
    $("#btnAdicionar").onclick = adicionarAoCarrinho;

    $("#barraCarrinho").onclick = () => { montarPedido(); abrirFolha("#folhaPedido"); };

    $("#btnCopiarPix").onclick = () => U.copiar(loja.chave_pix);
    $("#confNovo").onclick = () => {
      $("#telaConfirmado").classList.add("oculto");
      liberarRolagem();
      window.scrollTo(0, 0);
    };
  }

  iniciar();
})();
