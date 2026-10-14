// =====================================================================
// WL PEDIDOS - PAINEL DA LOJA
// Pedidos (tempo real por consulta a cada 5s), cardapio e dados da loja.
// =====================================================================
(function () {
  const { $, $$, esc, moeda } = U;
  const INTERVALO = 5000;
  const FORMAS_PADRAO = ["Pix", "Dinheiro", "Cartão", "Cartão de crédito", "Cartão de débito", "Vale-refeição"];

  let lojaId = null;
  let loja = null;

  // ------------------------------------------------------------------
  // Inicio
  // ------------------------------------------------------------------
  async function iniciar() {
    if (!WL.configurado()) { document.body.innerHTML = '<p class="aviso erro" style="margin:24px">Sistema não configurado. Preencha o config.js.</p>'; return; }
    if (!WL.logado() || !(await WL.garantirSessao())) { location.href = "login.html"; return; }

    try {
      lojaId = U.param("loja") || U.lerLocal("wl_ultima_loja", null);
      const [superAdmin, lojas] = await Promise.all([
        WL.rpc("is_super_admin"),
        WL.listar("lojas", { select: "*", order: "nome" })
      ]);
      loja = lojas.find(l => l.id === lojaId) || (!superAdmin && lojas.length === 1 ? lojas[0] : null);
      if (!loja) { location.href = superAdmin ? "master.html" : "login.html"; return; }
      lojaId = loja.id;
      U.gravarLocal("wl_ultima_loja", lojaId);
      if (superAdmin || lojas.length > 1) {
        const link = $("#linkMaster");
        link.classList.remove("oculto");
        if (!superAdmin) { link.textContent = "Trocar loja"; link.href = "login.html"; }
      }
    } catch (e) {
      if (!WL.logado()) { location.href = "login.html"; return; }
      $("#carregando").innerHTML = '<p class="aviso erro">' + esc(e.message) + "</p>";
      return;
    }

    montarCabecalho();
    prepararAbas();
    prepararPedidos();
    prepararCardapio();
    prepararLoja();

    $("#carregando").classList.add("oculto");
    $("#app").classList.remove("oculto");
    cicloPedidos();
  }

  function urlCardapio() {
    return new URL("cardapio.html?loja=" + encodeURIComponent(loja.slug), location.href).href;
  }

  function montarCabecalho() {
    U.aplicarCor(loja.cor_primaria);
    document.title = loja.nome + " | Painel";
    $("#barraNome").textContent = loja.nome;
    $("#barraLink").href = urlCardapio();
    $("#btnBalcao").href = urlCardapio() + "&balcao=1";
    const logo = $("#barraLogo");
    if (loja.logo_url) { logo.src = loja.logo_url; logo.classList.remove("oculto"); }
    else logo.classList.add("oculto");
    atualizarInterruptor();

    $("#chkAberta").onchange = async () => {
      const aberta = $("#chkAberta").checked;
      try {
        const r = await WL.atualizar("lojas", { id: "eq." + lojaId }, { aberta });
        if (!r.length) throw new Error("Sem permissão para alterar a loja.");
        loja.aberta = aberta;
        U.toast(aberta ? "Loja aberta para pedidos" : "Loja fechada para pedidos");
      } catch (e) {
        U.toast(e.message, "erro");
      }
      atualizarInterruptor();
    };

    $("#btnSair").onclick = async () => { await WL.sair(); location.href = "login.html"; };
  }

  function atualizarInterruptor() {
    $("#chkAberta").checked = !!loja.aberta;
    $("#txtAberta").textContent = loja.aberta ? "Aberta" : "Fechada";
    $(".interruptor").classList.toggle("desligado", !loja.aberta);
  }

  function prepararAbas() {
    $$(".abas [data-aba]").forEach(b => b.addEventListener("click", () => {
      $$(".abas [data-aba]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
      $$(".aba").forEach(s => s.classList.toggle("oculto", s.id !== "aba-" + b.dataset.aba));
      if (b.dataset.aba === "cardapio") carregarCardapio();
      if (b.dataset.aba === "loja") preencherLoja();
    }));
  }

  // ==================================================================
  // PEDIDOS
  // ==================================================================
  let andamento = [];
  let doDia = [];
  const itensPorPedido = {};
  const conhecidos = new Set();
  let primeiraCarga = true;
  let filtro = "andamento";
  let naoVistos = 0;
  let audio = null;
  let somLigado = false;
  let cancelandoId = null;

  function prepararPedidos() {
    $$('input[name="filtro"]').forEach(r => r.addEventListener("change", () => { filtro = r.value; desenharPedidos(); }));

    $("#btnSom").onclick = () => {
      somLigado = !somLigado;
      if (somLigado) {
        try {
          audio = audio || new (window.AudioContext || window.webkitAudioContext)();
          audio.resume();
          bip();
        } catch (e) { somLigado = false; U.toast("Este navegador não permite som.", "erro"); }
      }
      $("#btnSom").textContent = somLigado ? "Som ligado" : "Ativar som";
      $("#btnSom").setAttribute("aria-pressed", String(somLigado));
    };

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { naoVistos = 0; document.title = loja.nome + " | Painel"; }
    });

    $("#listaPedidos").addEventListener("click", aoClicarPedido);

    $("#btnConfirmarCancelar").onclick = confirmarCancelamento;
    $$("[data-fechar-modal]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
  }

  async function cicloPedidos() {
    try {
      await carregarPedidos();
      $("#statusConexao").textContent = "";
      $("#statusConexao").classList.remove("erro");
    } catch (e) {
      if (!WL.logado()) { location.href = "login.html"; return; }
      $("#statusConexao").textContent = "Sem conexão com o servidor. Tentando de novo…";
      $("#statusConexao").classList.add("erro");
    }
    setTimeout(cicloPedidos, INTERVALO);
  }

  async function carregarPedidos() {
    const hoje = U.hojeNoFuso(loja.fuso);
    const [a, d] = await Promise.all([
      WL.listar("pedidos", { select: "*", loja_id: "eq." + lojaId, status: "not.in.(Finalizado,Cancelado)", order: "criado_em.asc" }),
      WL.listar("pedidos", { select: "*", loja_id: "eq." + lojaId, data_ref: "eq." + hoje, order: "criado_em.desc" })
    ]);
    andamento = a;
    doDia = d;

    const faltando = [...new Set(a.concat(d).map(p => p.id))].filter(id => !itensPorPedido[id]);
    for (let i = 0; i < faltando.length; i += 80) {
      const parte = faltando.slice(i, i + 80);
      const itens = await WL.listar("itens_pedido", { select: "*", pedido_id: "in.(" + parte.join(",") + ")", order: "id" });
      parte.forEach(id => { itensPorPedido[id] = []; });
      itens.forEach(it => itensPorPedido[it.pedido_id].push(it));
    }

    let novos = 0;
    a.forEach(p => {
      if (!conhecidos.has(p.id)) {
        if (!primeiraCarga && p.origem === "Cliente") novos++;
        conhecidos.add(p.id);
      }
    });
    primeiraCarga = false;
    if (novos) avisarNovos(novos);

    desenharResumo();
    desenharPedidos();
  }

  function avisarNovos(n) {
    U.toast(n === 1 ? "Novo pedido chegou!" : n + " novos pedidos chegaram!");
    if (somLigado) bip();
    if (document.hidden) {
      naoVistos += n;
      document.title = "(" + naoVistos + ") Novo pedido! | " + loja.nome;
    }
  }

  function bip() {
    if (!audio) return;
    const agora = audio.currentTime;
    [0, 0.22, 0.44].forEach((t, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = "sine";
      o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, agora + t);
      g.gain.exponentialRampToValueAtTime(0.35, agora + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, agora + t + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(agora + t);
      o.stop(agora + t + 0.2);
    });
  }

  function desenharResumo() {
    const validos = doDia.filter(p => p.status !== "Cancelado");
    const total = validos.reduce((s, p) => s + Number(p.total), 0);
    $("#resPedidos").textContent = validos.length + (validos.length === 1 ? " pedido" : " pedidos");
    $("#resVendas").textContent = moeda(total);
    $("#resTicket").textContent = validos.length ? ". Ticket médio " + moeda(total / validos.length) : "";

    const fin = doDia.filter(p => p.status === "Finalizado").length;
    const can = doDia.filter(p => p.status === "Cancelado").length;
    $("#qtdAndamento").textContent = andamento.length ? "(" + andamento.length + ")" : "";
    $("#qtdFinalizados").textContent = fin ? "(" + fin + ")" : "";
    $("#qtdCancelados").textContent = can ? "(" + can + ")" : "";
    const badge = $("#badgeAndamento");
    badge.textContent = andamento.length;
    badge.classList.toggle("oculto", !andamento.length);
  }

  function pedidosDoFiltro() {
    if (filtro === "finalizados") return doDia.filter(p => p.status === "Finalizado");
    if (filtro === "cancelados") return doDia.filter(p => p.status === "Cancelado");
    return andamento;
  }

  function proximaEtapa(p) {
    const etapas = U.etapas(p.tipo_atendimento);
    const i = etapas.indexOf(p.status);
    return i >= 0 && i < etapas.length - 1 ? etapas[i + 1] : null;
  }

  const TEXTO_BOTAO = {
    "Em preparo": "Começar preparo",
    "Saiu para entrega": "Saiu para entrega",
    "Pronto": "Marcar como pronto",
    "Finalizado": "Finalizar"
  };

  function desenharPedidos() {
    const lista = pedidosDoFiltro();
    const caixa = $("#listaPedidos");
    if (!lista.length) {
      const msg = filtro === "andamento"
        ? (loja.aberta ? "Nenhum pedido em andamento. Os novos aparecem aqui sozinhos." : "A loja está fechada. Ligue o botão \"Aberta\" no topo para receber pedidos.")
        : "Nada por aqui hoje.";
      caixa.innerHTML = '<p class="vazio">' + esc(msg) + "</p>";
      return;
    }
    caixa.innerHTML = lista.map(cartaoPedido).join("");
  }

  function cartaoPedido(p) {
    const itens = itensPorPedido[p.id] || [];
    const prox = proximaEtapa(p);
    const etapas = U.etapas(p.tipo_atendimento);
    const pos = etapas.indexOf(p.status);
    const classeTipo = p.tipo_atendimento === "Delivery" ? "tipo-entrega" : p.tipo_atendimento === "Mesa" ? "tipo-mesa" : "tipo-retirada";

    return `
      <article class="comanda pedido ${p.status === "Recebido" ? "pedido-novo" : ""} ${p.status === "Cancelado" ? "pedido-cancelado" : ""}" data-id="${p.id}">
        <header class="pedido-topo">
          <span class="comanda-numero pedido-numero">#${p.numero}</span>
          <span class="tipo ${classeTipo}">${esc(U.rotuloTipo(p))}</span>
          ${p.origem === "Manual" ? '<span class="tipo tipo-balcao">Balcão</span>' : ""}
          <time datetime="${esc(p.criado_em)}" class="pedido-hora">${U.hora(p.criado_em)}<br><small>${U.haQuanto(p.criado_em)}</small></time>
        </header>

        <p class="pedido-cliente"><strong>${esc(p.cliente_nome)}</strong>
          ${p.telefone ? `<a href="${U.linkWhatsapp(p.telefone)}" target="_blank" rel="noopener">${esc(U.telefoneBonito(p.telefone))}</a>` : ""}</p>
        ${p.endereco ? `<p class="pedido-endereco">${esc(p.endereco)}</p>` : ""}

        <ul class="pedido-itens">
          ${itens.map(i => `
            <li><span><b>${i.quantidade}x</b> ${esc(i.nome)}${i.tamanho ? " (" + esc(i.tamanho) + ")" : ""}</span><span>${moeda(i.total)}</span>
              ${U.resumoOpcoes(i.opcoes) ? `<small>${esc(U.resumoOpcoes(i.opcoes))}</small>` : ""}
              ${i.observacao ? `<small class="obs">Obs: ${esc(i.observacao)}</small>` : ""}
            </li>`).join("")}
        </ul>
        ${p.observacao ? `<p class="pedido-obs">Obs. do pedido: ${esc(p.observacao)}</p>` : ""}

        <div class="pedido-valores">
          ${Number(p.taxa_entrega) > 0 ? `<span>Entrega ${moeda(p.taxa_entrega)}</span>` : ""}
          <strong>Total ${moeda(p.total)}</strong>
          <span>${esc(p.pagamento || "Pagamento não informado")}${p.troco_para ? ", troco para " + moeda(p.troco_para) : ""}</span>
        </div>

        ${p.status === "Cancelado" ? `
          <p class="aviso erro">Cancelado${p.motivo_cancelamento ? ": " + esc(p.motivo_cancelamento) : ""}</p>
          <div class="pedido-acoes">
            ${p.telefone ? '<button class="btn btn-p" data-acao="whatsapp" type="button">Avisar cliente</button>' : ""}
            <button class="btn btn-p btn-perigo" data-acao="excluir" type="button">Excluir de vez</button>
          </div>` : `
          <ol class="mini-etapas" aria-label="Andamento: ${esc(p.status)}">
            ${etapas.map((e, i) => `<li class="${i <= pos ? "feita" : ""}" title="${esc(e)}"></li>`).join("")}
          </ol>
          <p class="pedido-status">${esc(p.status)}</p>
          <div class="pedido-acoes">
            ${prox ? `<button class="btn btn-cor btn-avancar" data-acao="avancar" data-status="${esc(prox)}" type="button">${esc(TEXTO_BOTAO[prox] || prox)}</button>` : ""}
            <button class="btn btn-p" data-acao="imprimir" type="button">Imprimir</button>
            ${p.telefone ? '<button class="btn btn-p" data-acao="whatsapp" type="button">WhatsApp</button>' : ""}
            ${p.status !== "Finalizado" ? '<button class="btn btn-p btn-texto btn-perigo" data-acao="cancelar" type="button">Cancelar</button>' : ""}
          </div>`}
      </article>`;
  }

  function acharPedido(id) {
    return andamento.find(p => p.id === id) || doDia.find(p => p.id === id);
  }

  async function aoClicarPedido(e) {
    const botao = e.target.closest("[data-acao]");
    if (!botao) return;
    const id = Number(botao.closest("[data-id]").dataset.id);
    const p = acharPedido(id);
    if (!p) return;
    const acao = botao.dataset.acao;

    if (acao === "avancar") {
      await U.ocupado(botao, "Salvando…", () => mudarStatus(p, botao.dataset.status));
    } else if (acao === "imprimir") {
      imprimir(p);
    } else if (acao === "whatsapp") {
      U.abrirLink(U.linkWhatsapp(p.telefone, mensagemCliente(p)));
    } else if (acao === "cancelar") {
      cancelandoId = p.id;
      $("#mcMotivo").value = "";
      $("#mcTitulo").textContent = "Cancelar pedido #" + p.numero;
      $("#modalCancelar").showModal();
      $("#mcMotivo").focus();
    } else if (acao === "excluir") {
      if (!(await U.confirmar("Excluir o pedido #" + p.numero + " para sempre? Ele sai do histórico.", "Excluir", true))) return;
      try {
        const r = await WL.excluir("pedidos", { id: "eq." + p.id });
        if (!r.length) throw new Error("Não foi possível excluir. Só pedidos cancelados podem ser excluídos.");
        doDia = doDia.filter(x => x.id !== p.id);
        desenharResumo(); desenharPedidos();
        U.toast("Pedido excluído");
      } catch (err) { U.toast(err.message, "erro"); }
    }
  }

  async function mudarStatus(p, status, motivo) {
    const dados = { status };
    if (status === "Cancelado") dados.motivo_cancelamento = motivo || null;
    try {
      const r = await WL.atualizar("pedidos", { id: "eq." + p.id }, dados);
      if (!r.length) throw new Error("Não foi possível atualizar o pedido.");
      Object.assign(p, r[0]);
      if (status === "Finalizado" || status === "Cancelado") andamento = andamento.filter(x => x.id !== p.id);
      const noDia = doDia.find(x => x.id === p.id);
      if (noDia && noDia !== p) Object.assign(noDia, r[0]);
      desenharResumo();
      desenharPedidos();
      U.toast("Pedido #" + p.numero + ": " + status);
    } catch (e) {
      U.toast(e.message, "erro");
    }
  }

  async function confirmarCancelamento() {
    const p = acharPedido(cancelandoId);
    if (!p) return;
    const motivo = $("#mcMotivo").value.trim();
    await U.ocupado($("#btnConfirmarCancelar"), "Cancelando…", () => mudarStatus(p, "Cancelado", motivo));
    $("#modalCancelar").close();
  }

  function linkAcompanhar(p) {
    return new URL("acompanhar.html?t=" + p.tracking_token, location.href).href;
  }

  function mensagemCliente(p) {
    const ola = "Olá, " + p.cliente_nome.split(" ")[0] + "! ";
    const ped = "Seu pedido #" + p.numero + " na " + loja.nome;
    const textos = {
      "Recebido": ola + "Recebemos o seu pedido #" + p.numero + " na " + loja.nome + ".",
      "Em preparo": ola + ped + " já está sendo preparado.",
      "Saiu para entrega": ola + ped + " saiu para entrega!",
      "Pronto": ola + ped + (p.tipo_atendimento === "Retirada" ? " está pronto para retirada." : " está pronto."),
      "Finalizado": ola + "Obrigado pela preferência! Volte sempre.",
      "Cancelado": ola + ped + " foi cancelado." + (p.motivo_cancelamento ? " Motivo: " + p.motivo_cancelamento + "." : "")
    };
    let msg = textos[p.status] || ped + ": " + p.status;
    if (p.status !== "Finalizado" && p.status !== "Cancelado") msg += "\nAcompanhe: " + linkAcompanhar(p);
    return msg;
  }

  // Papel da impressora termica: 58 mm (padrao) ou 80 mm, salvo por computador
  const PAPEIS = {
    "58": { pagina: 58, margem: 2, largura: "54mm", fonte: "13px" },
    "80": { pagina: 80, margem: 3, largura: "74mm", fonte: "15px" }
  };
  function papelAtual() {
    const v = String(U.lerLocal("wl_papel", "58"));
    return PAPEIS[v] ? v : "58";
  }

  function imprimirHtml(html) {
    const papel = PAPEIS[papelAtual()];
    let estilo = document.getElementById("estiloPagina");
    if (!estilo) {
      estilo = document.createElement("style");
      estilo.id = "estiloPagina";
      document.head.appendChild(estilo);
    }
    estilo.textContent = "@page { size: " + papel.pagina + "mm auto; margin: " + papel.margem + "mm; }";
    const caixa = $("#impressao");
    caixa.style.setProperty("--cupom-largura", papel.largura);
    caixa.style.setProperty("--cupom-fonte", papel.fonte);
    caixa.innerHTML = '<div class="cupom">' + html + '<div class="cupom-fim"></div></div>';
    window.print();
  }

  function imprimir(p) {
    const itens = itensPorPedido[p.id] || [];
    const tipo = p.tipo_atendimento === "Delivery" ? "ENTREGA"
      : p.tipo_atendimento === "Retirada" ? "RETIRADA NA LOJA"
      : "MESA " + (p.mesa || "");
    imprimirHtml(`
      <p class="cupom-centro cupom-loja">${esc(loja.nome.toUpperCase())}</p>
      <hr>
      <p class="cupom-centro cupom-numero">PEDIDO #${p.numero}</p>
      <p class="cupom-centro">${U.dataHora(p.criado_em)}</p>
      <p class="cupom-tipo">${esc(tipo)}</p>
      <p>Cliente: ${esc(p.cliente_nome)}</p>
      ${p.telefone ? `<p>Fone: ${esc(U.telefoneBonito(p.telefone))}</p>` : ""}
      ${p.endereco ? `<p>Endereço: ${esc(p.endereco)}</p>` : ""}
      <hr>
      ${itens.map(i => `
        <p class="cupom-item"><span>${i.quantidade}x ${esc(i.nome)}${i.tamanho ? " " + esc(i.tamanho) : ""}</span><span>${moeda(i.total)}</span></p>
        ${U.resumoOpcoes(i.opcoes) ? `<p class="cupom-det">${esc(U.resumoOpcoes(i.opcoes))}</p>` : ""}
        ${i.observacao ? `<p class="cupom-det">Obs: ${esc(i.observacao)}</p>` : ""}`).join("<hr>")}
      <hr>
      ${p.observacao ? `<p class="cupom-obs">OBS: ${esc(p.observacao)}</p>` : ""}
      <p class="cupom-item"><span>Subtotal</span><span>${moeda(p.subtotal)}</span></p>
      ${Number(p.taxa_entrega) > 0 ? `<p class="cupom-item"><span>Entrega</span><span>${moeda(p.taxa_entrega)}</span></p>` : ""}
      <p class="cupom-item cupom-total"><span>TOTAL</span><span>${moeda(p.total)}</span></p>
      <p>Pagamento: ${esc(p.pagamento || "-")}${p.troco_para ? " (troco para " + moeda(p.troco_para) + ")" : ""}</p>`);
  }

  function imprimirTeste() {
    imprimirHtml(`
      <p class="cupom-centro cupom-loja">${esc(loja.nome.toUpperCase())}</p>
      <hr>
      <p class="cupom-centro cupom-numero">TESTE</p>
      <p class="cupom-tipo">PAPEL ${papelAtual()} MM</p>
      <p class="cupom-item"><span>1x Produto de exemplo 500 ml</span><span>${moeda(22)}</span></p>
      <p class="cupom-det">Adicionais: Exemplo 1, Exemplo 2</p>
      <hr>
      <p class="cupom-item cupom-total"><span>TOTAL</span><span>${moeda(22)}</span></p>
      <p>Se o texto ficou pequeno ou cortado, troque o papel acima e teste de novo.</p>`);
  }

  // ==================================================================
  // CARDAPIO
  // ==================================================================
  let categorias = [];
  let produtos = [];
  let editando = null; // estado do editor de produto

  function prepararCardapio() {
    $("#btnNovaCategoria").onclick = novaCategoria;
    $("#btnNovoProduto").onclick = () => abrirEditor(null);
    $("#listaCardapio").addEventListener("click", aoClicarCardapio);

    $$('input[name="modoPreco"]').forEach(r => r.addEventListener("change", () => alternarModoPreco(r.value)));
    $("#btnAddTamanho").onclick = () => { lerEditor(); editando.tamanhos.push({ nome: "", preco: "" }); desenharTamanhos(); focarUltimo("#listaTamanhos", ".t-nome"); };
    $("#btnAddGrupo").onclick = () => {
      lerEditor();
      editando.grupos.push({ nome: "", minimo: 0, maximo: "", opcoes: [{ nome: "", preco: "", disponivel: true }] });
      desenharGrupos();
      focarUltimo("#listaGrupos", ".grupo-nome");
    };
    $("#listaTamanhos").addEventListener("click", e => {
      const b = e.target.closest("[data-remover-tamanho]");
      if (!b) return;
      lerEditor();
      editando.tamanhos.splice(Number(b.dataset.removerTamanho), 1);
      desenharTamanhos();
    });
    $("#listaGrupos").addEventListener("click", aoClicarGrupos);
    $("#btnSalvarProduto").onclick = salvarProduto;

    prepararImagem("#pImagemArquivo", "#pImagem", "#pImagemPrevia", "#pImagemRemover");
  }

  async function carregarCardapio() {
    const caixa = $("#listaCardapio");
    if (!produtos.length && !categorias.length) caixa.innerHTML = '<div class="carregando"><div class="girando"></div></div>';
    try {
      const filtro = { select: "*", loja_id: "eq." + lojaId, order: "ordem,id" };
      const [cats, prods, tams, grupos, opcoes] = await Promise.all([
        WL.listar("categorias", filtro),
        WL.listar("produtos", filtro),
        WL.listar("produto_tamanhos", filtro),
        WL.listar("grupos_opcoes", filtro),
        WL.listar("opcoes", filtro)
      ]);
      categorias = cats;
      produtos = prods.map(p => ({
        ...p,
        tamanhos: tams.filter(t => t.produto_id === p.id),
        grupos: grupos.filter(g => g.produto_id === p.id).map(g => ({ ...g, opcoes: opcoes.filter(o => o.grupo_id === g.id) }))
      }));
      desenharCardapio();
    } catch (e) {
      caixa.innerHTML = '<p class="aviso erro">' + esc(e.message) + "</p>";
    }
  }

  function rotuloPreco(p) {
    if (p.tamanhos.length) {
      return p.tamanhos.map(t => esc(t.nome) + " " + moeda(t.preco)).join(", ");
    }
    return moeda(p.preco);
  }

  function desenharCardapio() {
    const caixa = $("#listaCardapio");
    if (!categorias.length && !produtos.length) {
      caixa.innerHTML = `<div class="vazio cartao">
        <p>Comece criando as categorias (ex.: Lanches, Bebidas) e depois os produtos.</p>
        <button class="btn btn-escuro" type="button" data-acao="nova-categoria">Criar primeira categoria</button></div>`;
      return;
    }
    const secoes = categorias.map((c, i) => ({ c, i, itens: produtos.filter(p => p.categoria_id === c.id) }));
    const sem = produtos.filter(p => !p.categoria_id || !categorias.some(c => c.id === p.categoria_id));

    caixa.innerHTML = secoes.map(({ c, i, itens }) => `
      <section class="cat cartao ${c.ativa ? "" : "cat-oculta"}" data-cat="${c.id}">
        <header class="cat-cabeca">
          <h3>${esc(c.nome)} ${c.ativa ? "" : '<span class="etiqueta">Oculta</span>'}</h3>
          <div class="cat-acoes">
            <button class="btn btn-p btn-texto" data-acao="cat-subir" ${i === 0 ? "disabled" : ""} aria-label="Subir categoria">↑</button>
            <button class="btn btn-p btn-texto" data-acao="cat-descer" ${i === categorias.length - 1 ? "disabled" : ""} aria-label="Descer categoria">↓</button>
            <button class="btn btn-p btn-texto" data-acao="cat-renomear">Renomear</button>
            <button class="btn btn-p btn-texto" data-acao="cat-ocultar">${c.ativa ? "Ocultar" : "Mostrar"}</button>
            <button class="btn btn-p btn-texto btn-perigo" data-acao="cat-excluir">Excluir</button>
          </div>
        </header>
        ${itens.length ? itens.map((p, j) => linhaProduto(p, j, itens.length)).join("") : '<p class="texto-suave cat-vazia">Nenhum produto nesta categoria.</p>'}
        <button class="btn btn-p cat-novo" data-acao="novo-na-cat" type="button">Adicionar produto em ${esc(c.nome)}</button>
      </section>`).join("") +
      (sem.length ? `
      <section class="cat cartao" data-cat="">
        <header class="cat-cabeca"><h3>Sem categoria</h3></header>
        ${sem.map((p, j) => linhaProduto(p, j, sem.length)).join("")}
      </section>` : "");
  }

  function linhaProduto(p, j, total) {
    return `
      <div class="prod ${p.ativo ? "" : "prod-oculto"} ${p.disponivel ? "" : "prod-esgotado"}" data-prod="${p.id}">
        ${p.imagem_url ? `<img class="prod-foto" src="${esc(p.imagem_url)}" alt="" loading="lazy">` : '<span class="prod-foto prod-sem-foto"></span>'}
        <div class="prod-texto">
          <strong>${esc(p.nome)}</strong>
          <small>${rotuloPreco(p)}${p.grupos.length ? ", " + p.grupos.length + (p.grupos.length === 1 ? " grupo de opções" : " grupos de opções") : ""}</small>
          ${p.ativo ? "" : '<span class="etiqueta">Fora do cardápio</span>'}
        </div>
        <div class="prod-acoes">
          <button class="btn btn-p esgotado-btn" data-acao="prod-esgotado" aria-pressed="${!p.disponivel}" type="button">${p.disponivel ? "Disponível" : "Esgotado"}</button>
          <button class="btn btn-p" data-acao="prod-editar" type="button">Editar</button>
          <button class="btn btn-p btn-texto" data-acao="prod-subir" ${j === 0 ? "disabled" : ""} aria-label="Subir produto">↑</button>
          <button class="btn btn-p btn-texto" data-acao="prod-descer" ${j === total - 1 ? "disabled" : ""} aria-label="Descer produto">↓</button>
          <button class="btn btn-p btn-texto btn-perigo" data-acao="prod-excluir" type="button">Excluir</button>
        </div>
      </div>`;
  }

  async function novaCategoria() {
    const nome = (await U.perguntar("Nome da nova categoria (ex.: Lanches, Bebidas):", "", "Criar categoria") || "").trim();
    if (!nome) return;
    try {
      const ordem = categorias.reduce((m, c) => Math.max(m, c.ordem), 0) + 1;
      await WL.inserir("categorias", { loja_id: lojaId, nome: nome.slice(0, 60), ordem });
      await carregarCardapio();
      U.toast("Categoria criada");
    } catch (e) { U.toast(e.message, "erro"); }
  }

  // Reordena uma lista trocando um item de lugar e grava a nova ordem
  async function mover(tabela, lista, indice, delta) {
    const novo = lista.slice();
    const alvo = indice + delta;
    if (alvo < 0 || alvo >= novo.length) return;
    [novo[indice], novo[alvo]] = [novo[alvo], novo[indice]];
    const mudancas = novo.map((x, i) => ({ x, ordem: i + 1 })).filter(m => m.x.ordem !== m.ordem);
    await Promise.all(mudancas.map(m => WL.atualizar(tabela, { id: "eq." + m.x.id }, { ordem: m.ordem })));
    await carregarCardapio();
  }

  async function aoClicarCardapio(e) {
    const b = e.target.closest("[data-acao]");
    if (!b) return;
    const acao = b.dataset.acao;
    if (acao === "nova-categoria") return novaCategoria();

    const secao = b.closest("[data-cat]");
    const catId = secao && secao.dataset.cat ? Number(secao.dataset.cat) : null;
    const cat = categorias.find(c => c.id === catId);
    const linha = b.closest("[data-prod]");
    const prod = linha ? produtos.find(p => p.id === Number(linha.dataset.prod)) : null;

    try {
      if (acao === "cat-subir" || acao === "cat-descer") {
        await mover("categorias", categorias, categorias.indexOf(cat), acao === "cat-subir" ? -1 : 1);
      } else if (acao === "cat-renomear") {
        const nome = (await U.perguntar("Novo nome da categoria:", cat.nome) || "").trim();
        if (!nome || nome === cat.nome) return;
        await WL.atualizar("categorias", { id: "eq." + cat.id }, { nome: nome.slice(0, 60) });
        await carregarCardapio();
      } else if (acao === "cat-ocultar") {
        await WL.atualizar("categorias", { id: "eq." + cat.id }, { ativa: !cat.ativa });
        await carregarCardapio();
      } else if (acao === "cat-excluir") {
        if (!(await U.confirmar('Excluir a categoria "' + cat.nome + '"? Os produtos dela continuam, mas ficam sem categoria.', "Excluir", true))) return;
        await WL.excluir("categorias", { id: "eq." + cat.id });
        await carregarCardapio();
        U.toast("Categoria excluída");
      } else if (acao === "novo-na-cat") {
        abrirEditor(null, catId);
      } else if (acao === "prod-editar") {
        abrirEditor(prod);
      } else if (acao === "prod-esgotado") {
        await WL.atualizar("produtos", { id: "eq." + prod.id }, { disponivel: !prod.disponivel });
        prod.disponivel = !prod.disponivel;
        desenharCardapio();
        U.toast(prod.nome + (prod.disponivel ? " disponível" : " marcado como esgotado"));
      } else if (acao === "prod-subir" || acao === "prod-descer") {
        const irmaos = produtos.filter(p => p.categoria_id === prod.categoria_id);
        await mover("produtos", irmaos, irmaos.indexOf(prod), acao === "prod-subir" ? -1 : 1);
      } else if (acao === "prod-excluir") {
        if (!(await U.confirmar('Excluir "' + prod.nome + '"? Os pedidos antigos continuam guardados.', "Excluir", true))) return;
        await WL.excluir("produtos", { id: "eq." + prod.id });
        await carregarCardapio();
        U.toast("Produto excluído");
      }
    } catch (err) {
      U.toast(err.message, "erro");
    }
  }

  // ----- Editor de produto -----
  function abrirEditor(p, categoriaId) {
    editando = p ? {
      id: p.id,
      tamanhos: p.tamanhos.map(t => ({ id: t.id, nome: t.nome, preco: t.preco })),
      grupos: p.grupos.map(g => ({ id: g.id, nome: g.nome, minimo: g.minimo, maximo: g.maximo == null ? "" : g.maximo,
        opcoes: g.opcoes.map(o => ({ id: o.id, nome: o.nome, preco: o.preco, disponivel: o.disponivel })) }))
    } : { id: null, tamanhos: [], grupos: [] };

    $("#mpTitulo").textContent = p ? "Editar produto" : "Novo produto";
    $("#pNome").value = p ? p.nome : "";
    $("#pDescricao").value = p ? (p.descricao || "") : "";
    $("#pCategoria").innerHTML = '<option value="">Sem categoria</option>' +
      categorias.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
    $("#pCategoria").value = p ? (p.categoria_id || "") : (categoriaId || (categorias[0] ? categorias[0].id : ""));
    $("#pImagem").value = p ? (p.imagem_url || "") : "";
    $("#pImagem").dispatchEvent(new Event("input"));
    $("#pPreco").value = p && p.preco != null ? valorTexto(Number(p.preco)) : "";
    $("#pAtivo").checked = p ? p.ativo : true;
    $("#erroProduto").classList.add("oculto");

    const modo = editando.tamanhos.length ? "tamanhos" : "unico";
    $$('input[name="modoPreco"]').forEach(r => { r.checked = r.value === modo; });
    desenharTamanhos();
    desenharGrupos();
    mostrarModoPreco(modo);
    $("#modalProduto").showModal();
    $("#modalProduto .modal-corpo").scrollTop = 0;
    $("#pNome").focus();
  }

  function mostrarModoPreco(modo) {
    $("#campoPrecoUnico").classList.toggle("oculto", modo !== "unico");
    $("#editorTamanhos").classList.toggle("oculto", modo !== "tamanhos");
  }

  // Quando a pessoa troca entre "Preco unico" e "Por tamanho"
  function alternarModoPreco(modo) {
    lerEditor();
    if (modo === "tamanhos" && !editando.tamanhos.length) {
      editando.tamanhos.push({ nome: "", preco: "" });
      desenharTamanhos();
    }
    mostrarModoPreco(modo);
  }

  function valorTexto(v) {
    if (v === "" || v == null) return "";
    if (typeof v === "number") return v.toFixed(2).replace(".", ",");
    return String(v);
  }

  function desenharTamanhos() {
    $("#listaTamanhos").innerHTML = editando.tamanhos.map((t, i) => `
      <div class="linha-editor" data-tamanho="${i}">
        <input class="t-nome" placeholder="Ex.: 500 ml, Grande" maxlength="40" value="${esc(t.nome)}" aria-label="Nome do tamanho">
        <input class="t-preco" placeholder="Preço" inputmode="decimal" value="${esc(valorTexto(t.preco))}" aria-label="Preço do tamanho">
        <button class="btn btn-p btn-texto btn-perigo" type="button" data-remover-tamanho="${i}" aria-label="Remover tamanho">✕</button>
      </div>`).join("");
  }

  function desenharGrupos() {
    $("#listaGrupos").innerHTML = editando.grupos.map((g, gi) => `
      <div class="grupo-editor" data-grupo="${gi}">
        <div class="grupo-editor-topo">
          <input class="grupo-nome" placeholder="Nome do grupo (ex.: Frutas)" maxlength="60" value="${esc(g.nome)}" aria-label="Nome do grupo">
          <button class="btn btn-p btn-texto btn-perigo" type="button" data-remover-grupo="${gi}">Remover grupo</button>
        </div>
        <div class="grupo-editor-regras">
          <label>Mínimo <input class="g-min" type="number" min="0" max="50" value="${esc(g.minimo)}"></label>
          <label>Máximo <input class="g-max" type="number" min="1" max="50" value="${esc(g.maximo)}" placeholder="sem limite"></label>
          <small>Mínimo 0 = opcional. Máximo vazio = sem limite.</small>
        </div>
        ${g.opcoes.map((o, oi) => `
          <div class="linha-editor linha-opcao" data-opcao="${oi}">
            <input class="o-nome" placeholder="Opção (ex.: Morango)" maxlength="60" value="${esc(o.nome)}" aria-label="Nome da opção">
            <input class="o-preco" placeholder="+ 0,00" inputmode="decimal" value="${esc(valorTexto(o.preco))}" aria-label="Preço adicional">
            <label class="o-disp" title="Desmarque quando acabar"><input type="checkbox" class="o-disponivel" ${o.disponivel ? "checked" : ""}> Tem</label>
            <button class="btn btn-p btn-texto btn-perigo" type="button" data-remover-opcao="${gi}:${oi}" aria-label="Remover opção">✕</button>
          </div>`).join("")}
        <button class="btn btn-p" type="button" data-add-opcao="${gi}">Adicionar opção</button>
      </div>`).join("");
  }

  function aoClicarGrupos(e) {
    const b = e.target.closest("button");
    if (!b) return;
    lerEditor();
    if (b.dataset.removerGrupo !== undefined) {
      editando.grupos.splice(Number(b.dataset.removerGrupo), 1);
    } else if (b.dataset.addOpcao !== undefined) {
      const gi = Number(b.dataset.addOpcao);
      editando.grupos[gi].opcoes.push({ nome: "", preco: "", disponivel: true });
      desenharGrupos();
      const linhas = $$(`[data-grupo="${gi}"] .o-nome`);
      linhas[linhas.length - 1].focus();
      return;
    } else if (b.dataset.removerOpcao !== undefined) {
      const [gi, oi] = b.dataset.removerOpcao.split(":").map(Number);
      editando.grupos[gi].opcoes.splice(oi, 1);
    } else {
      return;
    }
    desenharGrupos();
  }

  function focarUltimo(raiz, sel) {
    const campos = $$(sel, $(raiz));
    if (campos.length) campos[campos.length - 1].focus();
  }

  // Copia o que esta digitado nos campos para o estado do editor
  // (os campos sempre sao desenhados a partir do estado, entao ficam em sincronia)
  function lerEditor() {
    editando.tamanhos = $$("#listaTamanhos [data-tamanho]").map((linha, i) => ({
      id: (editando.tamanhos[i] || {}).id,
      nome: $(".t-nome", linha).value,
      preco: $(".t-preco", linha).value
    }));
    editando.grupos = $$("#listaGrupos [data-grupo]").map((caixa, gi) => {
      const antigo = editando.grupos[gi] || { opcoes: [] };
      return {
        id: antigo.id,
        nome: $(".grupo-nome", caixa).value,
        minimo: $(".g-min", caixa).value,
        maximo: $(".g-max", caixa).value,
        opcoes: $$("[data-opcao]", caixa).map((linha, oi) => ({
          id: (antigo.opcoes[oi] || {}).id,
          nome: $(".o-nome", linha).value,
          preco: $(".o-preco", linha).value,
          disponivel: $(".o-disponivel", linha).checked
        }))
      };
    });
  }

  function erroEditor(msg) {
    $("#erroProduto").textContent = msg;
    $("#erroProduto").classList.remove("oculto");
    $("#erroProduto").scrollIntoView({ block: "center", behavior: "smooth" });
  }

  async function salvarProduto() {
    lerEditor();
    $("#erroProduto").classList.add("oculto");
    const modo = $('input[name="modoPreco"]:checked').value;
    const nome = $("#pNome").value.trim();
    if (!nome) return erroEditor("Informe o nome do produto.");

    let preco = null;
    let tamanhos = [];
    if (modo === "unico") {
      preco = U.numero($("#pPreco").value);
      if (preco === null || !Number.isFinite(preco) || preco < 0) return erroEditor("Informe o preço do produto, ex.: 22,90");
    } else {
      tamanhos = editando.tamanhos.filter(t => t.nome.trim() || String(t.preco).trim());
      if (!tamanhos.length) return erroEditor("Cadastre pelo menos um tamanho com preço.");
      for (const t of tamanhos) {
        const v = U.numero(t.preco);
        if (!t.nome.trim()) return erroEditor("Dê um nome para cada tamanho.");
        if (v === null || !Number.isFinite(v) || v < 0) return erroEditor('Preço inválido no tamanho "' + t.nome + '".');
      }
      tamanhos = tamanhos.map(t => ({ id: t.id || null, nome: t.nome.trim(), preco: U.numero(t.preco) }));
    }

    const grupos = [];
    for (const g of editando.grupos) {
      const opcoes = g.opcoes.filter(o => o.nome.trim() || String(o.preco).trim());
      if (!g.nome.trim() && !opcoes.length) continue;
      if (!g.nome.trim()) return erroEditor("Dê um nome para cada grupo de opções.");
      if (!opcoes.length) return erroEditor('O grupo "' + g.nome + '" precisa de pelo menos uma opção.');
      const min = g.minimo === "" ? 0 : Number(g.minimo);
      const max = g.maximo === "" ? null : Number(g.maximo);
      if (!Number.isInteger(min) || min < 0) return erroEditor('Mínimo inválido em "' + g.nome + '".');
      if (max !== null && (!Number.isInteger(max) || max < 1)) return erroEditor('Máximo inválido em "' + g.nome + '".');
      if (max !== null && max < min) return erroEditor('Em "' + g.nome + '" o máximo não pode ser menor que o mínimo.');
      if (min > opcoes.length) return erroEditor('Em "' + g.nome + '" o mínimo é maior que o número de opções.');
      const lista = [];
      for (const o of opcoes) {
        if (!o.nome.trim()) return erroEditor('Dê um nome para cada opção de "' + g.nome + '".');
        const v = String(o.preco).trim() === "" ? 0 : U.numero(o.preco);
        if (!Number.isFinite(v) || v < 0) return erroEditor('Preço inválido em "' + o.nome + '".');
        lista.push({ id: o.id || null, nome: o.nome.trim(), preco: v, disponivel: o.disponivel });
      }
      grupos.push({ id: g.id || null, nome: g.nome.trim(), minimo: min, maximo: max, opcoes: lista });
    }

    const payload = {
      id: editando.id,
      categoria_id: $("#pCategoria").value ? Number($("#pCategoria").value) : null,
      nome,
      descricao: $("#pDescricao").value.trim(),
      imagem_url: $("#pImagem").value.trim(),
      preco,
      ativo: $("#pAtivo").checked,
      tamanhos,
      grupos
    };

    await U.ocupado($("#btnSalvarProduto"), "Salvando…", async () => {
      try {
        await WL.rpc("salvar_produto", { p_loja: lojaId, p: payload });
        $("#modalProduto").close();
        U.toast("Produto salvo");
        await carregarCardapio();
      } catch (e) {
        erroEditor(e.message);
      }
    });
  }

  // ----- Envio de imagens (reduz o tamanho antes de enviar) -----
  async function reduzirImagem(arquivo, maximo) {
    try {
      const bmp = await createImageBitmap(arquivo);
      const escala = Math.min(1, maximo / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * escala);
      c.height = Math.round(bmp.height * escala);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, "image/webp", 0.82));
      if (blob && blob.type === "image/webp") return { blob, ext: "webp" };
      const jpg = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
      return { blob: jpg, ext: "jpg" };
    } catch (e) {
      return { blob: arquivo, ext: (arquivo.name.split(".").pop() || "jpg").toLowerCase() };
    }
  }

  function prepararImagem(selArquivo, selUrl, selPrevia, selRemover) {
    const campoUrl = $(selUrl), previa = $(selPrevia);
    campoUrl.addEventListener("input", () => {
      const v = campoUrl.value.trim();
      previa.classList.toggle("oculto", !v);
      if (v) previa.src = v;
    });
    previa.onerror = () => previa.classList.add("oculto");
    $(selRemover).onclick = () => { campoUrl.value = ""; campoUrl.dispatchEvent(new Event("input")); };
    $(selArquivo).addEventListener("change", async e => {
      const arquivo = e.target.files[0];
      e.target.value = "";
      if (!arquivo) return;
      if (!/^image\//.test(arquivo.type)) return U.toast("Escolha um arquivo de imagem.", "erro");
      if (arquivo.size > 15 * 1024 * 1024) return U.toast("Imagem muito grande (máximo 15 MB).", "erro");
      U.toast("Enviando imagem…");
      try {
        const { blob, ext } = await reduzirImagem(arquivo, 1000);
        const nome = lojaId + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
        const url = await WL.enviarImagem(nome, new File([blob], "imagem." + ext, { type: blob.type || arquivo.type }));
        campoUrl.value = url;
        campoUrl.dispatchEvent(new Event("input"));
        U.toast("Imagem enviada");
      } catch (err) {
        U.toast(err.message, "erro");
      }
    });
  }

  // ==================================================================
  // DADOS DA LOJA
  // ==================================================================
  function prepararLoja() {
    $("#btnCopiarLink").onclick = () => U.copiar(urlCardapio());
    $("#papelLargura").value = papelAtual();
    $("#papelLargura").onchange = () => {
      U.gravarLocal("wl_papel", $("#papelLargura").value);
      U.toast("Papel " + $("#papelLargura").value + " mm salvo neste computador");
    };
    $("#btnTesteImpressao").onclick = imprimirTeste;
    $("#formLoja").addEventListener("submit", e => { e.preventDefault(); salvarLoja(); });
    prepararImagem("#lLogoArquivo", "#lLogo", "#lLogoPrevia", "#lLogoRemover");
  }

  function preencherLoja() {
    const url = urlCardapio();
    $("#linkCardapio").textContent = url;
    $("#btnAbrirLink").href = url;
    $("#imgQR").classList.toggle("oculto", !!WL.demo);
    $("#btnBaixarQR").classList.toggle("oculto", !!WL.demo);
    if (!WL.demo) $("#imgQR").src = "https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=8&data=" + encodeURIComponent(url);
    $("#btnBaixarQR").href = "https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&margin=20&format=png&data=" + encodeURIComponent(url);

    $("#lNome").value = loja.nome;
    $("#lLogo").value = loja.logo_url || "";
    $("#lLogo").dispatchEvent(new Event("input"));
    $("#lCor").value = loja.cor_primaria;
    $("#lWhats").value = loja.whatsapp ? U.telefoneBonito(loja.whatsapp) : "";
    $("#lPix").value = loja.chave_pix || "";
    $("#lEndereco").value = loja.endereco || "";
    $("#lTaxa").value = valorTexto(loja.taxa_entrega);
    $("#lMinimo").value = valorTexto(loja.pedido_minimo);
    $("#lDelivery").checked = loja.aceita_delivery;
    $("#lRetirada").checked = loja.aceita_retirada;
    $("#lMesa").checked = loja.aceita_mesa;
    $("#lMsgFechada").value = loja.mensagem_fechada || "";

    const formas = FORMAS_PADRAO.concat((loja.formas_pagamento || []).filter(f => !FORMAS_PADRAO.includes(f)));
    $("#lFormas").innerHTML = "<legend>Formas de pagamento</legend>" + formas.map(f =>
      `<label><input type="checkbox" value="${esc(f)}" ${(loja.formas_pagamento || []).includes(f) ? "checked" : ""}> ${esc(f)}</label>`).join("");
    $("#erroLoja").classList.add("oculto");
  }

  async function salvarLoja() {
    const erro = msg => { $("#erroLoja").textContent = msg; $("#erroLoja").classList.remove("oculto"); };
    $("#erroLoja").classList.add("oculto");
    const nome = $("#lNome").value.trim();
    const taxa = $("#lTaxa").value.trim() === "" ? 0 : U.numero($("#lTaxa").value);
    const minimo = $("#lMinimo").value.trim() === "" ? 0 : U.numero($("#lMinimo").value);
    const whats = $("#lWhats").value.replace(/\D/g, "");
    if (nome.length < 2) return erro("Informe o nome da loja.");
    if (!Number.isFinite(taxa) || taxa < 0) return erro("Taxa de entrega inválida.");
    if (!Number.isFinite(minimo) || minimo < 0) return erro("Pedido mínimo inválido.");
    if (whats && whats.length < 10) return erro("WhatsApp inválido. Use DDD + número.");
    const tipos = [$("#lDelivery").checked, $("#lRetirada").checked, $("#lMesa").checked];
    if (!tipos.some(Boolean)) return erro("Marque pelo menos um tipo de pedido.");

    const dados = {
      nome,
      logo_url: $("#lLogo").value.trim() || null,
      cor_primaria: $("#lCor").value,
      whatsapp: whats || null,
      chave_pix: $("#lPix").value.trim() || null,
      endereco: $("#lEndereco").value.trim() || null,
      taxa_entrega: taxa,
      pedido_minimo: minimo,
      aceita_delivery: tipos[0],
      aceita_retirada: tipos[1],
      aceita_mesa: tipos[2],
      formas_pagamento: $$("#lFormas input:checked").map(i => i.value),
      mensagem_fechada: $("#lMsgFechada").value.trim() || null
    };

    await U.ocupado($("#btnSalvarLoja"), "Salvando…", async () => {
      try {
        const r = await WL.atualizar("lojas", { id: "eq." + lojaId }, dados);
        if (!r.length) throw new Error("Sem permissão para alterar a loja.");
        loja = r[0];
        montarCabecalho();
        U.toast("Dados da loja salvos");
      } catch (e) {
        erro(e.message);
      }
    });
  }

  iniciar();
})();
