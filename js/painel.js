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
    prepararEntregas();

    $("#carregando").classList.add("oculto");
    $("#app").classList.remove("oculto");
    iniciarCiclo();
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
      const querAbrir = $("#chkAberta").checked;
      if (loja.horario_automatico && statusLoja) {
        atualizarInterruptor(); // so muda depois de confirmar
        try {
          if (!querAbrir) {
            if (!(await U.confirmar("Fechar a loja agora? Ela volta a abrir sozinha no próximo horário.", "Fechar agora", true))) return;
            statusLoja = await WL.rpc("pausar_loja", { p_loja: lojaId, p_pausar: true });
            U.toast("Loja fechada até o próximo horário");
          } else if (statusLoja.pausada && statusLoja.dentro_do_horario) {
            statusLoja = await WL.rpc("pausar_loja", { p_loja: lojaId, p_pausar: false });
            U.toast("Loja aberta de novo");
          } else {
            U.toast("Fora do horário de funcionamento. Para abrir agora, desligue o horário automático na aba Loja.", "erro");
          }
        } catch (e) { U.toast(e.message, "erro"); }
        atualizarInterruptor();
        if (filtro === "andamento") desenharPedidos();
        return;
      }
      try {
        const r = await WL.atualizar("lojas", { id: "eq." + lojaId }, { aberta: querAbrir });
        if (!r.length) throw new Error("Sem permissão para alterar a loja.");
        loja.aberta = querAbrir;
        if (statusLoja) statusLoja.aberta = querAbrir;
        U.toast(querAbrir ? "Loja aberta para pedidos" : "Loja fechada para pedidos");
      } catch (e) {
        U.toast(e.message, "erro");
      }
      atualizarInterruptor();
      if (filtro === "andamento") desenharPedidos();
    };

    $("#btnSair").onclick = async () => { await WL.sair(); location.href = "login.html"; };
  }

  // Situacao real da loja (considera o horario automatico). null = banco sem a Etapa 2.
  let statusLoja = null;
  function lojaAberta() { return statusLoja ? !!statusLoja.aberta : !!loja.aberta; }

  async function atualizarStatusLoja() {
    try {
      statusLoja = await WL.rpc("status_loja", { p_loja: lojaId });
    } catch (e) {
      statusLoja = null;
    }
    atualizarInterruptor();
  }

  function atualizarInterruptor() {
    const aberta = lojaAberta();
    let texto = aberta ? "Aberta" : "Fechada";
    if (loja.horario_automatico && statusLoja) {
      if (aberta && statusLoja.fecha_em) texto = "Aberta · até " + U.quando(statusLoja.fecha_em, loja.fuso).replace(/^hoje às /, "");
      else if (!aberta && statusLoja.pausada && statusLoja.dentro_do_horario) texto = "Fechada agora";
      else if (!aberta && statusLoja.abre_em) texto = "Fechada · abre " + U.quando(statusLoja.abre_em, loja.fuso).replace(/ às /, " ");
    }
    $("#chkAberta").checked = aberta;
    $("#txtAberta").textContent = texto;
    $(".interruptor").classList.toggle("desligado", !aberta);
    $(".interruptor").classList.toggle("automatico", !!loja.horario_automatico);
    $(".interruptor").title = loja.horario_automatico
      ? "Horário automático ligado. Clique para fechar agora (volta a abrir no próximo horário)."
      : "Abrir ou fechar a loja para pedidos";
  }

  function prepararAbas() {
    $$(".abas [data-aba]").forEach(b => b.addEventListener("click", () => {
      $$(".abas [data-aba]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
      $$(".aba").forEach(s => s.classList.toggle("oculto", s.id !== "aba-" + b.dataset.aba));
      if (b.dataset.aba === "cardapio") carregarCardapio();
      if (b.dataset.aba === "loja") preencherLoja();
      if (b.dataset.aba === "entregas") abrirAbaEntregas();
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
  let cancelandoId = null;
  let buscando = false;

  function prepararPedidos() {
    $$('input[name="filtro"]').forEach(r => r.addEventListener("change", () => {
      filtro = r.value;
      $("#historicoBusca").classList.toggle("oculto", filtro !== "historico");
      if (filtro === "historico" && !historicoCarregado) { definirPeriodo(7); carregarHistorico(); }
      desenharPedidos();
    }));
    $("#historicoBusca").addEventListener("submit", e => { e.preventDefault(); carregarHistorico(); });
    $$("[data-periodo]").forEach(b => b.addEventListener("click", () => {
      const n = Number(b.dataset.periodo);
      definirPeriodo(n === 1 ? -1 : n);
      carregarHistorico();
    }));

    Alarme.preparar();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        naoVistos = 0;
        Alarme.atualizarTitulo();
        cicloPedidos(); // ao voltar para a aba, busca na hora
      }
    });

    $("#listaPedidos").addEventListener("click", aoClicarPedido);

    $("#btnConfirmarCancelar").onclick = confirmarCancelamento;
    $$("[data-fechar-modal]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
  }

  // Relogio em Web Worker: o navegador quase nao atrasa timers de worker
  // quando a aba esta em segundo plano (o setTimeout normal fica preso).
  const Relogio = (function () {
    const ouvintes = [];
    let worker = null;
    function iniciar() {
      try {
        const codigo = "setInterval(function(){postMessage(0)},1000);";
        worker = new Worker(URL.createObjectURL(new Blob([codigo], { type: "text/javascript" })));
        worker.onmessage = () => ouvintes.forEach(f => f());
      } catch (e) {
        worker = null;
        setInterval(() => ouvintes.forEach(f => f()), 1000);
      }
    }
    return { iniciar, cadaSegundo: f => ouvintes.push(f) };
  })();

  let segundos = 0;
  function iniciarCiclo() {
    Relogio.cadaSegundo(() => {
      segundos++;
      if (segundos % (INTERVALO / 1000) === 0) cicloPedidos();
      if (segundos % 60 === 0) atualizarStatusLoja();
    });
    atualizarStatusLoja();
    Relogio.iniciar();
    cicloPedidos();
  }

  async function cicloPedidos() {
    if (buscando) return;
    buscando = true;
    try {
      await carregarPedidos();
      $("#statusConexao").textContent = "";
      $("#statusConexao").classList.remove("erro");
    } catch (e) {
      if (!WL.logado()) { location.href = "login.html"; return; }
      $("#statusConexao").textContent = "Sem conexão com o servidor. Tentando de novo…";
      $("#statusConexao").classList.add("erro");
    } finally {
      buscando = false;
    }
  }

  async function carregarPedidos() {
    const hoje = U.hojeNoFuso(loja.fuso);
    const [a, d] = await Promise.all([
      WL.listar("pedidos", { select: "*", loja_id: "eq." + lojaId, status: "not.in.(Finalizado,Cancelado)", order: "criado_em.asc" }),
      WL.listar("pedidos", { select: "*", loja_id: "eq." + lojaId, data_ref: "eq." + hoje, order: "criado_em.desc" })
    ]);
    andamento = a;
    doDia = d;

    await carregarItens(a.concat(d));
    await carregarEntregasDosPedidos(a.concat(d, filtro === "historico" ? historico : []));

    const novos = [];
    a.forEach(p => {
      if (!conhecidos.has(p.id)) {
        if (!primeiraCarga && p.origem === "Cliente") novos.push(p);
        conhecidos.add(p.id);
      }
    });
    primeiraCarga = false;
    if (novos.length) avisarNovos(novos);
    Alarme.conferir(a);

    desenharResumo();
    desenharPedidos();
  }

  async function carregarItens(pedidos) {
    const faltando = [...new Set(pedidos.map(p => p.id))].filter(id => !itensPorPedido[id]);
    for (let i = 0; i < faltando.length; i += 80) {
      const parte = faltando.slice(i, i + 80);
      const itens = await WL.listar("itens_pedido", { select: "*", pedido_id: "in.(" + parte.join(",") + ")", order: "id" });
      parte.forEach(id => { itensPorPedido[id] = []; });
      itens.forEach(it => itensPorPedido[it.pedido_id].push(it));
    }
  }

  // ---------- Historico (dias anteriores, com busca) ----------
  let historico = [];
  let historicoCarregado = false;

  function dataMenos(dias) {
    const hoje = U.hojeNoFuso(loja.fuso);
    const d = new Date(hoje + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - dias);
    return d.toISOString().slice(0, 10);
  }
  // n=0 hoje, n=-1 ontem, n>0 ultimos n dias
  function definirPeriodo(n) {
    if (n === -1) { $("#hDe").value = dataMenos(1); $("#hAte").value = dataMenos(1); }
    else { $("#hDe").value = dataMenos(Math.max(0, n - 1)); $("#hAte").value = dataMenos(0); }
  }

  async function carregarHistorico() {
    let de = $("#hDe").value, ate = $("#hAte").value;
    if (!de || !ate) { definirPeriodo(7); de = $("#hDe").value; ate = $("#hAte").value; }
    if (de > ate) { [de, ate] = [ate, de]; $("#hDe").value = de; $("#hAte").value = ate; }
    $("#hResumo").textContent = "Buscando…";
    try {
      historico = await WL.rpc("historico_pedidos", { p_loja: lojaId, p_de: de, p_ate: ate, p_busca: $("#hBusca").value.trim() || null });
      historicoCarregado = true;
      await carregarItens(historico);
      await carregarEntregasDosPedidos(historico);
    } catch (e) {
      historico = [];
      $("#hResumo").textContent = /historico_pedidos/.test(e.message) ? "Falta rodar o script 08-etapa2.sql no Supabase." : e.message;
      desenharPedidos();
      return;
    }
    desenharResumoHistorico();
    desenharPedidos();
  }

  function desenharResumoHistorico() {
    const validos = historico.filter(p => p.status !== "Cancelado");
    const total = validos.reduce((s, p) => s + Number(p.total), 0);
    const aReceber = validos.filter(p => !p.pago).reduce((s, p) => s + Number(p.total), 0);
    const entregas = validos.reduce((s, p) => s + Number(p.taxa_entrega || 0), 0);
    const partes = [validos.length + (validos.length === 1 ? " pedido" : " pedidos"), moeda(total) + " vendidos"];
    if (validos.length) partes.push("ticket médio " + moeda(total / validos.length));
    if (entregas > 0) partes.push(moeda(entregas) + " em taxas de entrega");
    if (aReceber > 0) partes.push("a receber " + moeda(aReceber));
    const canc = historico.length - validos.length;
    if (canc) partes.push(canc + (canc === 1 ? " cancelado" : " cancelados"));
    $("#hResumo").textContent = partes.join(" · ") + (historico.length >= 300 ? ". Mostrando os 300 mais recentes; diminua o período." : "");
  }

  function avisarNovos(lista) {
    const n = lista.length;
    U.toast(n === 1 ? "Novo pedido #" + lista[0].numero + " chegou!" : n + " novos pedidos chegaram!");
    if (document.hidden) naoVistos += n;
    Alarme.notificar(lista);
  }

  // ==================================================================
  // ALARME DE PEDIDO NOVO
  // Toca alto e repete ate alguem ver o pedido. Funciona com a aba em
  // segundo plano, mostra aviso do sistema e mantem a tela ligada.
  // ==================================================================
  const Alarme = (function () {
    const TOQUES = {
      campainha: { nome: "Campainha", duracao: 2.6 },
      sirene: { nome: "Sirene", duracao: 2.4 },
      bipe: { nome: "Bipe forte", duracao: 1.6 }
    };
    let ctx = null, saida = null;
    let pendentes = [];          // pedidos de cliente ainda nao vistos
    let tocandoAte = 0;          // evita sobrepor toques
    let piscar = false;
    let travaTela = null;

    const cfg = () => ({
      ligado: U.lerLocal("wl_som", true) !== false,
      volume: Math.min(1, Math.max(0.1, Number(U.lerLocal("wl_volume", 1)) || 1)),
      toque: TOQUES[U.lerLocal("wl_toque", "campainha")] ? U.lerLocal("wl_toque", "campainha") : "campainha",
      tela: U.lerLocal("wl_tela_ligada", true) !== false
    });

    const chaveVistos = () => "wl_vistos_" + lojaId;
    function vistos() { return new Set(U.lerLocal(chaveVistos(), [])); }
    function marcarVistos(ids) {
      const v = [...vistos(), ...ids];
      U.gravarLocal(chaveVistos(), [...new Set(v)].slice(-300));
    }

    function somPronto() { return !!ctx && ctx.state === "running"; }

    function criarAudio() {
      try {
        if (!ctx) {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 8;
          comp.attack.value = 0.003; comp.release.value = 0.15;
          saida = ctx.createGain();
          saida.connect(comp).connect(ctx.destination);
        }
        desenharEstado();
        if (ctx.state === "running") return Promise.resolve(true);
        return ctx.resume().then(() => { desenharEstado(); return somPronto(); }, () => false);
      } catch (e) { ctx = null; desenharEstado(); return Promise.resolve(false); }
    }

    // Liga o audio (precisa vir de um clique) e toca o toque escolhido
    function testar() {
      tocandoAte = 0;
      return criarAudio().then(ok => {
        if (!ok || !tocar(true)) U.toast("O navegador bloqueou o som. Clique de novo.", "erro");
      });
    }

    // Um tom com envelope curto; onda quadrada filtrada soa bem mais alto que a senoidal
    function tom(freq, inicio, dur, forma, freqFim) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 4200;
      o.type = forma || "square";
      o.frequency.setValueAtTime(freq, inicio);
      if (freqFim) o.frequency.linearRampToValueAtTime(freqFim, inicio + dur);
      g.gain.setValueAtTime(0.0001, inicio);
      g.gain.exponentialRampToValueAtTime(1, inicio + 0.012);
      g.gain.setValueAtTime(1, inicio + dur - 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
      o.connect(f).connect(g).connect(saida);
      o.start(inicio);
      o.stop(inicio + dur + 0.02);
    }

    function tocar(forcar) {
      if (!somPronto()) return false;
      const c = cfg();
      if (!c.ligado && !forcar) return false;
      const agora = ctx.currentTime;
      if (agora < tocandoAte) return true;
      saida.gain.setValueAtTime(0.55 * c.volume, agora);
      const t0 = agora + 0.03;
      if (c.toque === "campainha") {
        // trrrim... trrrim (dois tons alternando bem rapido)
        [0, 1.3].forEach(base => {
          for (let i = 0; i < 12; i++) tom(i % 2 ? 1318 : 1046, t0 + base + i * 0.075, 0.07);
        });
      } else if (c.toque === "sirene") {
        [0, 0.8, 1.6].forEach(base => { tom(700, t0 + base, 0.38, "sawtooth", 1500); tom(1500, t0 + base + 0.38, 0.38, "sawtooth", 700); });
      } else {
        [0, 0.3, 0.6, 1.0, 1.3].forEach((t, i) => tom(i === 2 || i === 4 ? 1568 : 1175, t0 + t, 0.22));
      }
      tocandoAte = agora + TOQUES[c.toque].duracao;
      return true;
    }

    // Chamado a cada busca de pedidos
    function conferir(emAndamento) {
      const v = vistos();
      pendentes = emAndamento.filter(p => p.origem === "Cliente" && p.status === "Recebido" && !v.has(p.id));
      desenharFaixa();
      atualizarTitulo();
    }

    function reconhecer(ids) {
      const lista = ids || pendentes.map(p => p.id);
      if (!lista.length) return;
      marcarVistos(lista);
      pendentes = pendentes.filter(p => !lista.includes(p.id));
      desenharFaixa();
      atualizarTitulo();
    }

    // A cada segundo: repete o toque e pisca o titulo enquanto houver pedido nao visto
    let contador = 0;
    function aCadaSegundo() {
      contador++;
      if (!pendentes.length) return;
      piscar = !piscar;
      atualizarTitulo();
      if (contador % 4 === 0 || ctx && ctx.currentTime >= tocandoAte + 1.2) tocar();
    }

    function atualizarTitulo() {
      if (pendentes.length) {
        document.title = (piscar ? "🔔 " : "🟢 ") + (pendentes.length === 1 ? "NOVO PEDIDO" : pendentes.length + " NOVOS PEDIDOS") + " | " + loja.nome;
      } else if (document.hidden && naoVistos) {
        document.title = "(" + naoVistos + ") Novo pedido! | " + loja.nome;
      } else {
        document.title = loja.nome + " | Painel";
      }
    }

    function notificar(lista) {
      if (!cfg().ligado) return;
      tocar();
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      try {
        const p = lista[0];
        const n = new Notification(lista.length === 1 ? "Novo pedido #" + p.numero : lista.length + " novos pedidos", {
          body: lista.length === 1
            ? p.cliente_nome + " · " + U.rotuloTipo(p) + " · " + moeda(p.total)
            : "Abra o painel para ver os pedidos.",
          tag: "wl-pedido-" + p.id,
          requireInteraction: true,
          icon: loja.logo_url || undefined
        });
        n.onclick = () => { window.focus(); irParaPedidos(); n.close(); };
      } catch (e) { /* alguns navegadores so permitem pelo service worker */ }
    }

    function irParaPedidos() {
      const aba = $('.abas [data-aba="pedidos"]');
      if (aba.getAttribute("aria-selected") !== "true") aba.click();
      const r = $('input[name="filtro"][value="andamento"]');
      if (!r.checked) { r.checked = true; filtro = "andamento"; desenharPedidos(); }
      const alvo = pendentes[0] && $('.pedido[data-id="' + pendentes[0].id + '"]');
      if (alvo) alvo.scrollIntoView({ behavior: "smooth", block: "center" });
      reconhecer();
      desenharPedidos();
    }

    async function pedirNotificacao() {
      if (!("Notification" in window)) { U.toast("Este navegador não mostra avisos do sistema.", "erro"); return; }
      try { await Notification.requestPermission(); } catch (e) { /* ignora */ }
      desenharEstado();
      if (Notification.permission === "granted") {
        try { new Notification("Avisos ligados", { body: "Você será avisado aqui quando chegar pedido novo." }); } catch (e) { /* ignora */ }
      } else if (Notification.permission === "denied") {
        U.toast("Avisos bloqueados. Clique no cadeado ao lado do endereço do site para liberar.", "erro");
      }
    }

    async function manterTela() {
      if (!cfg().tela || !("wakeLock" in navigator) || document.hidden || travaTela) return;
      try {
        travaTela = await navigator.wakeLock.request("screen");
        travaTela.addEventListener("release", () => { travaTela = null; });
      } catch (e) { travaTela = null; }
    }

    function desenharFaixa() {
      const faixa = $("#faixaAlarme");
      marcarFaixas();
      if (!pendentes.length) { faixa.classList.add("oculto"); marcarFaixas(); return; }
      const nums = pendentes.map(p => "#" + p.numero).join(", ");
      $("#faixaAlarmeTexto").textContent = (pendentes.length === 1 ? "Novo pedido " : "Novos pedidos ") + nums;
      faixa.classList.remove("oculto");
      marcarFaixas();
    }

    function marcarFaixas() {
      document.body.classList.toggle("com-faixa", !$("#faixaAlarme").classList.contains("oculto") || !$("#faixaSom").classList.contains("oculto"));
    }

    function desenharEstado() {
      const c = cfg();
      const botao = $("#btnSom");
      const pronto = somPronto();
      botao.textContent = !c.ligado ? "🔕 Som desligado" : pronto ? "🔔 Som ligado" : "🔔 Ativar som";
      botao.setAttribute("aria-pressed", String(c.ligado && pronto));
      botao.classList.toggle("som-atencao", c.ligado && !pronto);
      $("#faixaSom").classList.toggle("oculto", !c.ligado || pronto);
      marcarFaixas();

      // Aba Loja
      const notif = !("Notification" in window) ? "indisponivel" : Notification.permission;
      const st = $("#estadoNotificacao");
      if (st) {
        st.textContent = { granted: "Ligados", denied: "Bloqueados no navegador", default: "Ainda não permitidos", indisponivel: "Não disponível neste navegador" }[notif];
        st.className = "estado " + (notif === "granted" ? "estado-ok" : "estado-alerta");
        $("#btnNotificacao").classList.toggle("oculto", notif !== "default");
        $("#ajudaNotificacao").classList.toggle("oculto", notif !== "denied");
      }
    }

    function preparar() {
      // Qualquer clique na pagina libera o som (regra dos navegadores)
      let prontoAntes = false; // estado do som antes deste clique
      const liberar = e => {
        prontoAntes = somPronto();
        manterTela();
        // os botoes de som cuidam disso no proprio clique (e tocam o teste)
        if (e.target.closest && e.target.closest("#faixaSom, #btnSom, #cartaoAvisos")) return;
        if (cfg().ligado) criarAudio();
      };
      document.addEventListener("pointerdown", liberar, true);
      document.addEventListener("keydown", liberar, true);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) manterTela(); });

      $("#btnSom").onclick = () => {
        const ligar = !(cfg().ligado && prontoAntes);
        U.gravarLocal("wl_som", ligar);
        if (ligar) { testar(); U.toast("Som dos pedidos ligado"); }
        else U.toast("Som dos pedidos desligado");
        desenharEstado();
      };
      $("#btnFaixaSom").onclick = testar;
      $("#btnVerAlarme").onclick = irParaPedidos;
      $("#btnSilenciar").onclick = () => { reconhecer(); desenharPedidos(); U.toast("Alarme silenciado"); };

      // Configuracoes na aba Loja
      const c = cfg();
      $("#somVolume").value = Math.round(c.volume * 100);
      $("#somToque").innerHTML = Object.entries(TOQUES).map(([k, t]) => `<option value="${k}">${t.nome}</option>`).join("");
      $("#somToque").value = c.toque;
      $("#somTela").checked = c.tela;
      $("#somVolume").oninput = () => { U.gravarLocal("wl_volume", Number($("#somVolume").value) / 100); };
      $("#somVolume").onchange = testar;
      $("#somToque").onchange = () => { U.gravarLocal("wl_toque", $("#somToque").value); testar(); };
      $("#somTela").onchange = () => {
        U.gravarLocal("wl_tela_ligada", $("#somTela").checked);
        if ($("#somTela").checked) manterTela();
        else if (travaTela) { travaTela.release(); travaTela = null; }
      };
      $("#btnTestarSom").onclick = testar;
      $("#btnNotificacao").onclick = pedirNotificacao;

      Relogio.cadaSegundo(aCadaSegundo);
      desenharEstado();
    }

    const pendente = id => pendentes.some(p => p.id === id);
    return { preparar, conferir, reconhecer, notificar, atualizarTitulo, desenharEstado, pendente };
  })();

  function desenharResumo() {
    const validos = doDia.filter(p => p.status !== "Cancelado");
    const total = validos.reduce((s, p) => s + Number(p.total), 0);
    $("#resPedidos").textContent = validos.length + (validos.length === 1 ? " pedido" : " pedidos");
    $("#resVendas").textContent = moeda(total);
    $("#resTicket").textContent = validos.length ? ". Ticket médio " + moeda(total / validos.length) : "";
    const aReceber = validos.filter(p => !p.pago).reduce((s, p) => s + Number(p.total), 0);
    $("#resReceber").textContent = aReceber > 0 ? "A receber: " + moeda(aReceber) : "";

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
    if (filtro === "historico") return historico;
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
        ? (lojaAberta() ? "Nenhum pedido em andamento. Os novos aparecem aqui sozinhos."
          : loja.horario_automatico ? "A loja está fechada agora. Ela abre sozinha no próximo horário."
          : "A loja está fechada. Ligue o botão \"Aberta\" no topo para receber pedidos.")
        : filtro === "historico" ? (historicoCarregado ? "Nenhum pedido encontrado nesse período." : "")
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
      <article class="comanda pedido ${p.status === "Recebido" ? "pedido-novo" : ""} ${Alarme.pendente(p.id) ? "pedido-alarme" : ""} ${p.status === "Cancelado" ? "pedido-cancelado" : ""}" data-id="${p.id}">
        <header class="pedido-topo">
          <span class="comanda-numero pedido-numero">#${p.numero}</span>
          <span class="tipo ${classeTipo}">${esc(U.rotuloTipo(p))}</span>
          ${p.origem === "Manual" ? '<span class="tipo tipo-balcao">Balcão</span>' : ""}
          <time datetime="${esc(p.criado_em)}" class="pedido-hora">${U.hora(p.criado_em)}<br><small>${U.haQuanto(p.criado_em)}</small></time>
        </header>

        <p class="pedido-cliente"><strong>${esc(p.cliente_nome)}</strong>
          ${p.telefone ? `<a href="${U.linkWhatsapp(p.telefone)}" target="_blank" rel="noopener">${esc(U.telefoneBonito(p.telefone))}</a>` : ""}</p>
        ${p.endereco ? `<p class="pedido-endereco">${esc(p.endereco)}</p>` : ""}
        ${p.latitude != null ? `<p class="pedido-local"><span class="tipo tipo-km">📍 ${p.distancia_km != null ? U.km(p.distancia_km) : "local marcado"}</span>
          <a href="${U.linkMapa(p.latitude, p.longitude)}" target="_blank" rel="noopener">Abrir no mapa</a></p>` : ""}
        ${filtro === "historico" ? `<p class="pedido-data">${U.dataHora(p.criado_em)}</p>` : ""}
        ${linhaEntrega(p)}

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
          ${p.status !== "Cancelado" ? `<button type="button" class="pago-btn ${p.pago ? "pago-sim" : ""}" data-acao="pago" aria-pressed="${p.pago ? "true" : "false"}"
            title="${p.pago ? "Marcar como não pago" : "Marcar como pago"}">${p.pago ? "✓ Pago" : "A receber"}</button>` : ""}
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
            ${botaoEntrega(p)}
            ${p.status !== "Finalizado" ? '<button class="btn btn-p btn-texto btn-perigo" data-acao="cancelar" type="button">Cancelar</button>' : ""}
          </div>`}
      </article>`;
  }

  function acharPedido(id) {
    return andamento.find(p => p.id === id) || doDia.find(p => p.id === id) || historico.find(p => p.id === id);
  }

  async function aoClicarPedido(e) {
    const cartao = e.target.closest("[data-id]");
    if (cartao && Alarme.pendente(Number(cartao.dataset.id))) {
      Alarme.reconhecer([Number(cartao.dataset.id)]);
      cartao.classList.remove("pedido-alarme");
    }
    const botao = e.target.closest("[data-acao]");
    if (!botao) return;
    const id = Number(botao.closest("[data-id]").dataset.id);
    const p = acharPedido(id);
    if (!p) return;
    const acao = botao.dataset.acao;

    if (acao === "avancar") {
      await U.ocupado(botao, "Salvando…", () => mudarStatus(p, botao.dataset.status));
    } else if (acao === "pago") {
      await U.ocupado(botao, "…", () => marcarPago(p, !p.pago));
    } else if (acao === "imprimir") {
      imprimir(p);
    } else if (acao === "whatsapp") {
      U.abrirLink(U.linkWhatsapp(p.telefone, mensagemCliente(p)));
    } else if (acao === "despachar") {
      abrirDespacho(p);
    } else if (acao === "reenviar") {
      const en = entregasPorPedido[p.id];
      if (en) mostrarLinkEntrega(p, en, en.token);
    } else if (acao === "entregador") {
      U.abrirLink(U.linkWhatsapp("", mensagemEntregador(p)));
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
        historico = historico.filter(x => x.id !== p.id);
        if (filtro === "historico") desenharResumoHistorico();
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
      [doDia.find(x => x.id === p.id), historico.find(x => x.id === p.id)].forEach(x => { if (x && x !== p) Object.assign(x, r[0]); });
      desenharResumo();
      desenharPedidos();
      U.toast("Pedido #" + p.numero + ": " + status);
    } catch (e) {
      U.toast(e.message, "erro");
    }
  }

  async function marcarPago(p, pago) {
    try {
      const r = await WL.atualizar("pedidos", { id: "eq." + p.id }, { pago });
      if (!r.length) throw new Error("Não foi possível atualizar o pagamento.");
      [andamento.find(x => x.id === p.id), doDia.find(x => x.id === p.id), historico.find(x => x.id === p.id), p].forEach(x => { if (x) x.pago = r[0].pago; });
      if (filtro === "historico") desenharResumoHistorico();
      desenharResumo();
      desenharPedidos();
      U.toast("Pedido #" + p.numero + (pago ? ": pago" : ": a receber"));
    } catch (e) {
      const msg = /pago/.test(e.message) ? "Falta rodar o script 07-pagamento.sql no Supabase." : e.message;
      U.toast(msg, "erro");
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

  function mensagemEntregador(p) {
    const linhas = ["*Entrega - " + loja.nome + "*", "Pedido #" + p.numero + " · " + p.cliente_nome];
    if (p.telefone) linhas.push("Fone: " + U.telefoneBonito(p.telefone));
    if (p.endereco) linhas.push("Endereço: " + p.endereco);
    if (p.latitude != null) linhas.push("Localização" + (p.distancia_km != null ? " (" + U.km(p.distancia_km) + ")" : "") + ": " + U.linkMapa(p.latitude, p.longitude));
    linhas.push(p.pago ? "Pedido JÁ PAGO" : "Cobrar do cliente: " + moeda(p.total) + " (" + (p.pagamento || "pagamento não informado") + ")" +
      (p.troco_para ? ", levar troco para " + moeda(p.troco_para) : ""));
    if (Number(p.taxa_entrega) > 0) linhas.push("Taxa de entrega: " + moeda(p.taxa_entrega));
    return linhas.join("\n");
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
      ${p.distancia_km != null ? `<p>Distância: ${U.km(p.distancia_km)}</p>` : ""}
      ${entregasPorPedido[p.id] ? `<p>Entregador: ${esc(entregasPorPedido[p.id].entregador_nome)}</p>` : ""}
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
      <p>Pagamento: ${esc(p.pagamento || "-")}${p.troco_para ? " (troco para " + moeda(p.troco_para) + ")" : ""}</p>
      <p class="cupom-tipo">${p.pago ? "JÁ PAGO" : "A RECEBER " + moeda(p.total)}</p>`);
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
  // ENTREGADORES (despacho, pagina do entregador e acerto)
  // ==================================================================
  let entregadores = [];
  let entregadoresCarregados = false;
  const entregasPorPedido = {};
  let entregasOk = null; // false = banco sem o script 09
  const semTabelaEntregas = e => /entrega/i.test(e.message || "");

  async function carregarEntregadores() {
    try {
      entregadores = await WL.listar("entregadores", { select: "*", loja_id: "eq." + lojaId, order: "nome" });
      entregadoresCarregados = true;
      entregasOk = true;
    } catch (e) {
      if (semTabelaEntregas(e)) entregasOk = false;
      else throw e;
    }
  }

  async function carregarEntregasDosPedidos(pedidos) {
    if (entregasOk === false) return;
    const ids = [...new Set(pedidos.filter(p => p.tipo_atendimento === "Delivery").map(p => p.id))];
    try {
      for (let i = 0; i < ids.length; i += 80) {
        const parte = ids.slice(i, i + 80);
        const linhas = await WL.listar("entregas", { select: "*", pedido_id: "in.(" + parte.join(",") + ")", status: "neq.Cancelada" });
        parte.forEach(id => { delete entregasPorPedido[id]; });
        linhas.forEach(en => { entregasPorPedido[en.pedido_id] = en; });
      }
      entregasOk = true;
    } catch (e) {
      if (semTabelaEntregas(e)) entregasOk = false;
    }
  }

  function linhaEntrega(p) {
    const en = entregasPorPedido[p.id];
    if (!en || p.tipo_atendimento !== "Delivery") return "";
    const quando = en.status === "Entregue" && en.entregue_em ? " às " + U.hora(en.entregue_em)
      : en.status === "A caminho" && en.saiu_em ? " desde " + U.hora(en.saiu_em) : "";
    const classe = en.status === "Entregue" ? "moto-ok" : en.status === "A caminho" ? "moto-caminho" : "";
    return `<p class="pedido-entrega"><span class="tipo tipo-moto ${classe}">🛵 ${esc(en.entregador_nome)} · ${esc(en.status === "Enviada" ? "aguardando sair" : en.status.toLowerCase())}${quando}</span>
      ${en.status !== "Entregue" ? '<button class="btn btn-p btn-texto" data-acao="reenviar" type="button">Reenviar link</button>' : ""}</p>`;
  }

  function botaoEntrega(p) {
    if (p.tipo_atendimento !== "Delivery" || p.status === "Finalizado" || p.status === "Cancelado") return "";
    if (entregasOk === false) return '<button class="btn btn-p" data-acao="entregador" type="button" title="Mandar endereço e localização para o entregador">Entregador</button>';
    const en = entregasPorPedido[p.id];
    if (en && en.status === "Entregue") return "";
    return `<button class="btn btn-p ${en ? "" : "btn-moto"}" data-acao="despachar" type="button">${en ? "Trocar entregador" : "🛵 Despachar"}</button>`;
  }

  // ---------- Janela de despacho ----------
  let despachando = null;

  function textoDiferenca(valor, taxa) {
    if (!Number.isFinite(valor)) return "";
    const t = Number(taxa || 0);
    if (Math.abs(valor - t) < 0.005) return "Igual à taxa que o cliente pagou (" + moeda(t) + ").";
    if (valor > t) return "O cliente pagou " + moeda(t) + " de taxa. A loja paga a diferença de " + moeda(valor - t) + ".";
    return "O cliente pagou " + moeda(t) + " de taxa. Sobram " + moeda(t - valor) + " para a loja.";
  }

  function desenharOpcoesEntregadores(selecionado) {
    const ativos = entregadores.filter(e => e.ativo);
    $("#mdEntregadores").innerHTML = ativos.length ? ativos.map(e => `
      <label class="md-entregador"><input type="radio" name="mdEntregador" value="${e.id}" ${e.id === selecionado ? "checked" : ""}>
        <span><b>${esc(e.nome)}</b><small>${e.valor_padrao != null ? moeda(e.valor_padrao) + " por entrega" : "recebe a taxa do pedido"}</small></span></label>`).join("")
      : '<p class="texto-suave">Nenhum entregador cadastrado ainda. Cadastre abaixo.</p>';
    $("#mdNovo").open = !ativos.length;
    $$('input[name="mdEntregador"]').forEach(r => r.addEventListener("change", () => escolherEntregador(Number(r.value))));
    if (selecionado) escolherEntregador(selecionado);
  }

  function escolherEntregador(id) {
    const e = entregadores.find(x => x.id === id);
    if (!e || !despachando) return;
    const valor = e.valor_padrao != null ? Number(e.valor_padrao) : Number(despachando.taxa_entrega || 0);
    $("#mdValor").value = valorTexto(valor);
    $("#mdDiferenca").textContent = textoDiferenca(valor, despachando.taxa_entrega);
  }

  async function abrirDespacho(p) {
    despachando = p;
    if (!entregadoresCarregados) { try { await carregarEntregadores(); } catch (e) { return U.toast(e.message, "erro"); } }
    if (entregasOk === false) return U.toast("Falta rodar o script 09-entregadores.sql no Supabase.", "erro");
    $("#mdTitulo").textContent = "Despachar pedido #" + p.numero;
    const cobrar = p.pago ? "já pago" : p.pagamento === "Pix" ? "Pix ainda não marcado como pago (" + moeda(p.total) + ")"
      : "cobrar " + moeda(p.total) + (p.pagamento ? " (" + p.pagamento + ")" : "");
    $("#mdResumo").textContent = p.cliente_nome + " · " + (p.endereco || "") + (p.distancia_km != null ? " · " + U.km(p.distancia_km) : "") + " · " + cobrar;
    $("#mdPasso1").classList.remove("oculto");
    $("#mdPasso2").classList.add("oculto");
    $("#btnDespachar").classList.remove("oculto");
    $("#mdRodape [data-fechar-modal]").textContent = "Cancelar";
    $("#erroDespachar").classList.add("oculto");
    $("#mdNovoNome").value = ""; $("#mdNovoWhats").value = "";
    const atual = entregasPorPedido[p.id];
    const ultimo = Number(U.lerLocal("wl_ultimo_entregador_" + lojaId, 0));
    const ativos = entregadores.filter(e => e.ativo);
    const sel = [atual && atual.entregador_id, ultimo].find(id => ativos.some(e => e.id === id)) || (ativos[0] && ativos[0].id);
    $("#mdValor").value = ""; $("#mdDiferenca").textContent = "";
    desenharOpcoesEntregadores(sel);
    $("#modalDespachar").showModal();
  }

  async function cadastrarNoDespacho() {
    const nome = $("#mdNovoNome").value.trim();
    const whats = $("#mdNovoWhats").value.replace(/\D/g, "");
    if (nome.length < 2) return U.toast("Informe o nome do entregador.", "erro");
    if (whats && whats.length < 10) return U.toast("WhatsApp inválido. Use DDD + número.", "erro");
    await U.ocupado($("#btnMdNovo"), "Salvando…", async () => {
      try {
        const r = await WL.inserir("entregadores", { loja_id: lojaId, nome, whatsapp: whats || null });
        entregadores.push(r[0]);
        entregadores.sort((a, b) => a.nome.localeCompare(b.nome));
        desenharOpcoesEntregadores(r[0].id);
        $("#mdNovo").open = false;
      } catch (e) { U.toast(e.message, "erro"); }
    });
  }

  async function confirmarDespacho() {
    const p = despachando;
    const marcado = $('input[name="mdEntregador"]:checked');
    const erro = msg => { $("#erroDespachar").textContent = msg; $("#erroDespachar").classList.remove("oculto"); };
    if (!marcado) return erro("Escolha o entregador.");
    const valor = $("#mdValor").value.trim() === "" ? NaN : U.numero($("#mdValor").value);
    if (!Number.isFinite(valor) || valor < 0) return erro("Informe quanto o entregador vai receber.");
    const en = entregadores.find(e => e.id === Number(marcado.value));
    await U.ocupado($("#btnDespachar"), "Despachando…", async () => {
      try {
        const r = await WL.rpc("despachar_pedido", { p_pedido: p.id, p_entregador: en.id, p_valor: valor });
        U.gravarLocal("wl_ultimo_entregador_" + lojaId, en.id);
        const entrega = { entregador_nome: en.nome, entregador_whatsapp: en.whatsapp, valor_entregador: valor, status: "Enviada", token: r.token, pedido_id: p.id, entregador_id: en.id };
        entregasPorPedido[p.id] = entrega;
        mostrarLinkEntrega(p, entrega, r.token, true);
        desenharPedidos();
        cicloPedidos();
      } catch (e) { erro(e.message); }
    });
  }

  function linkEntrega(token) { return new URL("entregador.html?t=" + token, location.href).href; }

  function mensagemDespacho(p, en, token) {
    const linhas = ["*Entrega - " + loja.nome + "*", "Pedido #" + p.numero + " · " + p.cliente_nome];
    if (p.endereco) linhas.push("Endereço: " + p.endereco + (p.distancia_km != null ? " (" + U.km(p.distancia_km) + ")" : ""));
    linhas.push(p.pago ? "Pagamento: JÁ PAGO, não cobrar" :
      "Cobrar: " + moeda(p.total) + " (" + (p.pagamento || "pagamento não informado") + ")" + (p.troco_para ? ", troco para " + moeda(p.troco_para) : ""));
    linhas.push("Você recebe: " + moeda(en.valor_entregador));
    linhas.push("", "Abra o link para ver o mapa e marcar a entrega:", linkEntrega(token));
    return linhas.join("\n");
  }

  function mostrarLinkEntrega(p, en, token, recemDespachado) {
    despachando = p;
    $("#mdTitulo").textContent = "Pedido #" + p.numero;
    $("#mdOkTexto").textContent = recemDespachado ? "Pedido despachado para " + en.entregador_nome + "." : "Entrega com " + en.entregador_nome + ".";
    $("#mdZap").href = U.linkWhatsapp(en.entregador_whatsapp || "", mensagemDespacho(p, en, token));
    $("#mdZap").textContent = en.entregador_whatsapp ? "Enviar para " + en.entregador_nome.split(" ")[0] + " no WhatsApp" : "Enviar no WhatsApp";
    $("#mdCopiar").onclick = () => U.copiar(linkEntrega(token));
    $("#mdPasso1").classList.add("oculto");
    $("#mdPasso2").classList.remove("oculto");
    $("#btnDespachar").classList.add("oculto");
    $("#mdRodape [data-fechar-modal]").textContent = "Fechar";
    if (!$("#modalDespachar").open) $("#modalDespachar").showModal();
  }

  // ---------- Aba Entregas: cadastro e acerto ----------
  let acertoDias = 0;

  function prepararEntregas() {
    $("#btnMdNovo").onclick = cadastrarNoDespacho;
    $("#btnDespachar").onclick = confirmarDespacho;
    $("#mdValor").addEventListener("input", () => {
      if (!despachando) return;
      const v = $("#mdValor").value.trim() === "" ? NaN : U.numero($("#mdValor").value);
      $("#mdDiferenca").textContent = textoDiferenca(v, despachando.taxa_entrega);
    });
    $("#formEntregador").addEventListener("submit", e => { e.preventDefault(); salvarEntregador(); });
    $("#btnCancelarEntregador").onclick = limparFormEntregador;
    $("#listaEntregadores").addEventListener("click", aoClicarEntregador);
    $$("[data-acerto]").forEach(b => b.addEventListener("click", () => { acertoDias = Number(b.dataset.acerto); carregarAcerto(); }));
    $("#listaAcerto").addEventListener("click", aoClicarAcerto);
    $("#chkCodigoEntrega").addEventListener("change", async () => {
      const valor = $("#chkCodigoEntrega").checked;
      try {
        const r = await WL.atualizar("lojas", { id: "eq." + lojaId }, { codigo_entrega: valor });
        if (!r.length) throw new Error("Sem permissão para alterar a loja.");
        loja.codigo_entrega = valor;
        U.toast(valor ? "Código de entrega ligado (vale para os próximos despachos)" : "Código de entrega desligado");
      } catch (e) {
        $("#chkCodigoEntrega").checked = !valor;
        U.toast(/codigo_entrega/.test(e.message) ? "Falta rodar o script 09-entregadores.sql no Supabase." : e.message, "erro");
      }
    });
  }

  async function abrirAbaEntregas() {
    try { await carregarEntregadores(); } catch (e) { U.toast(e.message, "erro"); }
    const aviso = $("#avisoEntregas");
    aviso.classList.toggle("oculto", entregasOk !== false);
    aviso.textContent = "Para usar entregadores, rode o script 09-entregadores.sql no Supabase (SQL Editor).";
    $(".entregas-layout").classList.toggle("oculto", entregasOk === false);
    if (entregasOk === false) return;
    $("#chkCodigoEntrega").checked = !!loja.codigo_entrega;
    desenharEntregadores();
    carregarAcerto();
  }

  function desenharEntregadores() {
    const caixa = $("#listaEntregadores");
    if (!entregadores.length) { caixa.innerHTML = '<p class="vazio-p">Nenhum entregador ainda.</p>'; return; }
    caixa.innerHTML = entregadores.map(e => `
      <div class="entregador-item ${e.ativo ? "" : "inativo"}" data-id="${e.id}">
        <div>
          <strong>${esc(e.nome)}</strong>${e.ativo ? "" : ' <span class="etiqueta">desativado</span>'}
          <small>${e.whatsapp ? esc(U.telefoneBonito(e.whatsapp)) + " · " : ""}${e.valor_padrao != null ? moeda(e.valor_padrao) + " por entrega" : "recebe a taxa do pedido"}</small>
        </div>
        <div class="entregador-acoes">
          <button type="button" class="btn btn-p btn-texto" data-ent="editar">Editar</button>
          <button type="button" class="btn btn-p btn-texto" data-ent="ativo">${e.ativo ? "Desativar" : "Ativar"}</button>
          <button type="button" class="btn btn-p btn-texto btn-perigo" data-ent="excluir" aria-label="Excluir ${esc(e.nome)}">Excluir</button>
        </div>
      </div>`).join("");
  }

  function limparFormEntregador() {
    $("#feId").value = ""; $("#feNome").value = ""; $("#feWhats").value = ""; $("#feValor").value = "";
    $("#feTitulo").textContent = "Novo entregador";
    $("#btnSalvarEntregador").textContent = "Cadastrar";
    $("#btnCancelarEntregador").classList.add("oculto");
    $("#erroEntregador").classList.add("oculto");
  }

  async function salvarEntregador() {
    const erro = msg => { $("#erroEntregador").textContent = msg; $("#erroEntregador").classList.remove("oculto"); };
    $("#erroEntregador").classList.add("oculto");
    const nome = $("#feNome").value.trim();
    const whats = $("#feWhats").value.replace(/\D/g, "");
    const valorTxt = $("#feValor").value.trim();
    const valor = valorTxt === "" ? null : U.numero(valorTxt);
    if (nome.length < 2) return erro("Informe o nome do entregador.");
    if (whats && whats.length < 10) return erro("WhatsApp inválido. Use DDD + número.");
    if (valor !== null && (!Number.isFinite(valor) || valor < 0)) return erro("Valor por entrega inválido.");
    const dados = { nome, whatsapp: whats || null, valor_padrao: valor };
    const id = Number($("#feId").value) || null;
    await U.ocupado($("#btnSalvarEntregador"), "Salvando…", async () => {
      try {
        if (id) {
          const r = await WL.atualizar("entregadores", { id: "eq." + id }, dados);
          if (!r.length) throw new Error("Não foi possível salvar.");
          Object.assign(entregadores.find(e => e.id === id), r[0]);
        } else {
          const r = await WL.inserir("entregadores", Object.assign({ loja_id: lojaId }, dados));
          entregadores.push(r[0]);
        }
        entregadores.sort((a, b) => a.nome.localeCompare(b.nome));
        limparFormEntregador();
        desenharEntregadores();
        U.toast(id ? "Entregador atualizado" : "Entregador cadastrado");
      } catch (e) { erro(e.message); }
    });
  }

  async function aoClicarEntregador(e) {
    const b = e.target.closest("[data-ent]");
    if (!b) return;
    const id = Number(b.closest("[data-id]").dataset.id);
    const en = entregadores.find(x => x.id === id);
    if (b.dataset.ent === "editar") {
      $("#feId").value = id; $("#feNome").value = en.nome;
      $("#feWhats").value = en.whatsapp ? U.telefoneBonito(en.whatsapp) : "";
      $("#feValor").value = en.valor_padrao != null ? valorTexto(en.valor_padrao) : "";
      $("#feTitulo").textContent = "Editar " + en.nome;
      $("#btnSalvarEntregador").textContent = "Salvar";
      $("#btnCancelarEntregador").classList.remove("oculto");
      $("#feNome").focus();
    } else if (b.dataset.ent === "ativo") {
      try {
        const r = await WL.atualizar("entregadores", { id: "eq." + id }, { ativo: !en.ativo });
        Object.assign(en, r[0]);
        desenharEntregadores();
      } catch (err) { U.toast(err.message, "erro"); }
    } else if (b.dataset.ent === "excluir") {
      if (!(await U.confirmar("Excluir " + en.nome + "? As entregas que ele já fez continuam no histórico.", "Excluir", true))) return;
      try {
        await WL.excluir("entregadores", { id: "eq." + id });
        entregadores = entregadores.filter(x => x.id !== id);
        desenharEntregadores();
      } catch (err) { U.toast(err.message, "erro"); }
    }
  }

  let acertoGrupos = [];
  async function carregarAcerto() {
    const de = acertoDias === 1 ? dataMenos(1) : dataMenos(Math.max(0, acertoDias - 1));
    const ate = acertoDias === 1 ? dataMenos(1) : dataMenos(0);
    $$("[data-acerto]").forEach(b => b.classList.toggle("btn-escuro", Number(b.dataset.acerto) === acertoDias));
    $("#acertoPeriodo").textContent = de === ate ? "Dia " + de.split("-").reverse().join("/") : "De " + de.split("-").reverse().join("/") + " até " + ate.split("-").reverse().join("/");
    const caixa = $("#listaAcerto");
    caixa.innerHTML = '<p class="vazio-p">Carregando…</p>';
    let entregas;
    try {
      entregas = (await WL.listar("entregas", { select: "*", loja_id: "eq." + lojaId, data_ref: "gte." + de, status: "neq.Cancelada", order: "criado_em" }))
        .filter(x => x.data_ref <= ate);
      const ids = [...new Set(entregas.map(x => x.pedido_id))];
      const pedidos = {};
      for (let i = 0; i < ids.length; i += 80) {
        (await WL.listar("pedidos", { select: "id,numero,cliente_nome", id: "in.(" + ids.slice(i, i + 80).join(",") + ")" }))
          .forEach(p => { pedidos[p.id] = p; });
      }
      entregas.forEach(x => { x._pedido = pedidos[x.pedido_id] || {}; });
    } catch (e) {
      caixa.innerHTML = '<p class="aviso erro">' + esc(e.message) + "</p>";
      return;
    }
    const grupos = {};
    entregas.forEach(x => {
      const chave = x.entregador_id ? "id" + x.entregador_id : "nome" + x.entregador_nome;
      (grupos[chave] = grupos[chave] || { nome: x.entregador_nome, whatsapp: x.entregador_whatsapp, lista: [] }).lista.push(x);
    });
    acertoGrupos = Object.values(grupos).sort((a, b) => a.nome.localeCompare(b.nome));
    if (!acertoGrupos.length) { caixa.innerHTML = '<p class="vazio-p">Nenhuma entrega despachada nesse período.</p>'; return; }

    let totalDif = 0, totalEnt = 0;
    caixa.innerHTML = acertoGrupos.map((g, gi) => {
      const feitas = g.lista.filter(x => x.status === "Entregue");
      const pendentes = g.lista.filter(x => x.status !== "Entregue");
      const soma = (l, f) => l.reduce((s, x) => s + Number(f(x) || 0), 0);
      const pagar = soma(feitas, x => x.valor_entregador);
      const taxas = soma(feitas, x => x.taxa_cliente);
      const dinheiro = soma(feitas.filter(x => x.forma_pagamento === "Dinheiro"), x => x.recebido);
      const outros = soma(feitas.filter(x => x.forma_pagamento !== "Dinheiro"), x => x.recebido);
      const saldo = pagar - dinheiro;
      const abertas = feitas.filter(x => !x.acertado_em);
      totalDif += pagar - taxas; totalEnt += feitas.length;
      g.resumo = { feitas, pagar, taxas, dinheiro, saldo, abertas };
      const saldoTexto = Math.abs(saldo) < 0.005 ? "Nada a pagar: a conta fecha certinho."
        : saldo > 0 ? "A loja paga " + moeda(saldo) + " para " + g.nome.split(" ")[0] + "."
        : g.nome.split(" ")[0] + " devolve " + moeda(-saldo) + " para a loja.";
      return `<article class="acerto-item" data-grupo="${gi}">
        <header class="acerto-cabeca">
          <h4>🛵 ${esc(g.nome)}</h4>
          ${feitas.length && !abertas.length ? '<span class="estado estado-ok">Acertado ✓</span>' : ""}
        </header>
        <dl class="acerto-numeros">
          <div><dt>Entregas feitas</dt><dd>${feitas.length}${pendentes.length ? ` <small>(+${pendentes.length} em andamento)</small>` : ""}</dd></div>
          <div><dt>Taxas pagas pelos clientes</dt><dd>${moeda(taxas)}</dd></div>
          <div><dt>Valor do entregador</dt><dd>${moeda(pagar)}</dd></div>
          ${pagar - taxas > 0.005 ? `<div class="destaque-ruim"><dt>Diferença paga pela loja</dt><dd>${moeda(pagar - taxas)}</dd></div>` : ""}
          <div><dt>Recebeu em dinheiro dos clientes</dt><dd>${moeda(dinheiro)}</dd></div>
          ${outros > 0 ? `<div><dt>Recebeu em cartão/pix na entrega</dt><dd>${moeda(outros)}</dd></div>` : ""}
        </dl>
        <p class="acerto-saldo ${saldo < -0.005 ? "devolve" : ""}">${esc(saldoTexto)}</p>
        <div class="linha-botoes">
          ${abertas.length ? `<button type="button" class="btn btn-p btn-escuro" data-acerto-acao="acertar">Marcar como acertado (${abertas.length})</button>` : ""}
          ${g.whatsapp ? '<button type="button" class="btn btn-p" data-acerto-acao="zap">Mandar resumo no WhatsApp</button>' : ""}
        </div>
        <details class="acerto-detalhe"><summary>Ver entregas</summary>
          <ul>${g.lista.map(x => `<li><span>#${x._pedido.numero || "?"} ${esc(x._pedido.cliente_nome || "")}</span>
            <span>${esc(x.status)}${x.entregue_em ? " " + U.hora(x.entregue_em) : ""}</span><span>${moeda(x.valor_entregador)}</span></li>`).join("")}</ul>
        </details>
      </article>`;
    }).join("") + (totalEnt ? `<p class="acerto-total">${totalEnt} ${totalEnt === 1 ? "entrega" : "entregas"} no período${totalDif > 0.005 ? " · a loja pagou " + moeda(totalDif) + " de diferença nas taxas" : totalDif < -0.005 ? " · sobraram " + moeda(-totalDif) + " das taxas para a loja" : ""}.</p>` : "");
  }

  async function aoClicarAcerto(e) {
    const b = e.target.closest("[data-acerto-acao]");
    if (!b) return;
    const g = acertoGrupos[Number(b.closest("[data-grupo]").dataset.grupo)];
    const r = g.resumo;
    if (b.dataset.acertoAcao === "acertar") {
      if (!(await U.confirmar("Marcar " + r.abertas.length + " entrega(s) de " + g.nome + " como acertadas?", "Marcar acertado"))) return;
      try {
        await WL.atualizar("entregas", { id: "in.(" + r.abertas.map(x => x.id).join(",") + ")" }, { acertado_em: new Date().toISOString() });
        U.toast("Acerto registrado");
        carregarAcerto();
      } catch (err) { U.toast(err.message, "erro"); }
    } else if (b.dataset.acertoAcao === "zap") {
      const linhas = ["*Acerto - " + loja.nome + "*", $("#acertoPeriodo").textContent, "",
        "Entregas: " + r.feitas.length, "Valor das entregas: " + moeda(r.pagar), "Recebido em dinheiro: " + moeda(r.dinheiro), "",
        Math.abs(r.saldo) < 0.005 ? "Saldo: zerado" : r.saldo > 0 ? "A loja te paga: " + moeda(r.saldo) : "Você devolve para a loja: " + moeda(-r.saldo)];
      U.abrirLink(U.linkWhatsapp(g.whatsapp, linhas.join("\n")));
    }
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
  let lojaAlterada = false;

  // ---------- Entrega por distancia ----------
  let localLoja = null;   // {lat, lng}
  let mapaLoja = null;
  const CENTRO_PADRAO = { lat: -23.3101, lng: -51.3690 }; // Rolandia-PR (so para abrir o mapa)

  function modoTaxa() { return ($('input[name="modoTaxa"]:checked') || {}).value || "fixa"; }

  function mostrarModoTaxa() {
    const dist = modoTaxa() === "distancia";
    $("#blocoDistancia").classList.toggle("oculto", !dist);
    $("#lTaxaRotulo").textContent = dist ? "Taxa sem localização" : "Taxa de entrega";
    $("#lTaxaAjuda").classList.toggle("oculto", !dist);
    if (dist) abrirMapaLoja();
  }

  async function abrirMapaLoja() {
    const c = localLoja || CENTRO_PADRAO;
    try {
      if (!mapaLoja) {
        mapaLoja = await U.criarMapa($("#mapaLoja"), c.lat, c.lng, localLoja ? 16 : 14, (la, ln) => {
          localLoja = { lat: Math.round(la * 1e6) / 1e6, lng: Math.round(ln * 1e6) / 1e6 };
          desenharLocalLoja();
          marcarLoja(true);
        });
        mapaLoja.alfinete.setOpacity(localLoja ? 1 : 0.35);
      } else {
        mapaLoja.alfinete.setLatLng([c.lat, c.lng]);
        mapaLoja.alfinete.setOpacity(localLoja ? 1 : 0.35);
        mapaLoja.mapa.setView([c.lat, c.lng], localLoja ? 16 : 14);
      }
      setTimeout(() => mapaLoja.mapa.invalidateSize(), 100);
    } catch (e) {
      $("#lLocalTexto").textContent = e.message;
    }
  }

  function desenharLocalLoja() {
    if (mapaLoja) mapaLoja.alfinete.setOpacity(localLoja ? 1 : 0.35);
    $("#lLocalTexto").textContent = localLoja
      ? "Local da loja marcado (" + localLoja.lat.toFixed(5) + ", " + localLoja.lng.toFixed(5) + ")."
      : "Local ainda não marcado. Clique no mapa na porta da loja.";
    $("#lLocalTexto").classList.toggle("alerta", !localLoja);
  }

  async function buscarEndereco() {
    const q = $("#lBuscaEndereco").value.trim();
    const lista = $("#resultadosEndereco");
    if (q.length < 4) return U.toast("Digite rua, número e cidade.", "erro");
    await U.ocupado($("#btnBuscaEndereco"), "…", async () => {
      try {
        const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=br&accept-language=pt-BR&q=" + encodeURIComponent(q));
        const dados = await r.json();
        if (!dados.length) { lista.innerHTML = "<li>Nada encontrado. Tente sem o número ou clique direto no mapa.</li>"; }
        else {
          lista.innerHTML = dados.map((d, i) => `<li><button type="button" data-i="${i}">${esc(d.display_name)}</button></li>`).join("");
          $$("#resultadosEndereco [data-i]").forEach(b => b.onclick = async () => {
            const d = dados[Number(b.dataset.i)];
            await abrirMapaLoja();
            mapaLoja.mover(Number(d.lat), Number(d.lon), true);
            lista.classList.add("oculto");
            U.toast("Confira se o alfinete ficou na porta da loja.");
          });
        }
        lista.classList.remove("oculto");
      } catch (e) {
        U.toast("Busca indisponível agora. Clique direto no mapa.", "erro");
      }
    });
  }

  function linhaFaixa(f) {
    return `<div class="faixa">
        <label>Até <input class="f-km" inputmode="decimal" value="${f.ate_km != null ? String(f.ate_km).replace(".", ",") : ""}" aria-label="Até quantos km"> km</label>
        <label class="campo-reais"><i>R$</i><input class="f-valor" inputmode="decimal" value="${f.valor != null ? valorTexto(f.valor) : ""}" aria-label="Valor"></label>
        <button type="button" class="btn btn-p btn-texto btn-perigo" data-remover-faixa aria-label="Remover faixa">✕</button>
      </div>`;
  }
  function desenharFaixas(lista) {
    const faixas = lista.length ? lista : [{ ate_km: 3, valor: null }];
    $("#listaFaixas").innerHTML = faixas.map(linhaFaixa).join("") + '<p id="faixaLimite" class="faixa-limite"></p>';
    atualizarLimiteFaixas();
  }
  function lerFaixas() {
    return $$("#listaFaixas .faixa").map(d => ({
      ate_km: d.querySelector(".f-km").value.trim() === "" ? NaN : U.numero(d.querySelector(".f-km").value),
      valor: d.querySelector(".f-valor").value.trim() === "" ? NaN : U.numero(d.querySelector(".f-valor").value)
    }));
  }
  function atualizarLimiteFaixas() {
    const kms = lerFaixas().map(f => f.ate_km).filter(Number.isFinite);
    $("#faixaLimite").textContent = kms.length ? "Acima de " + U.km(Math.max.apply(null, kms)) + ": a loja não entrega." : "";
  }

  // ---------- Horarios da semana ----------
  const DIAS = [[1, "Segunda"], [2, "Terça"], [3, "Quarta"], [4, "Quinta"], [5, "Sexta"], [6, "Sábado"], [0, "Domingo"]];
  const HORA_OK = /^([01]\d|2[0-3]):[0-5]\d$/;

  function desenharHorarios(h) {
    h = h && typeof h === "object" ? h : {};
    $("#listaHorarios").innerHTML = DIAS.map(([d, nome]) => {
      const f = Array.isArray(h[d]) ? h[d] : [];
      const a = f[0] || {}, b = f[1] || {};
      return `<div class="dia ${f.length ? "" : "dia-fechado"}" data-dia="${d}">
          <label class="dia-nome"><input type="checkbox" class="h-on" ${f.length ? "checked" : ""}> ${nome}</label>
          <span class="dia-horas">
            <input type="time" class="h-abre1" value="${esc(a.abre || "18:00")}" aria-label="${nome}: abre"> às
            <input type="time" class="h-fecha1" value="${esc(a.fecha || "23:00")}" aria-label="${nome}: fecha">
            <span class="h-segundo ${f[1] ? "" : "oculto"}">e <input type="time" class="h-abre2" value="${esc(b.abre || "")}" aria-label="${nome}: abre de novo"> às
              <input type="time" class="h-fecha2" value="${esc(b.fecha || "")}" aria-label="${nome}: fecha de novo"></span>
            <button type="button" class="btn btn-p btn-texto h-mais ${f[1] ? "oculto" : ""}">+ 2º horário</button>
          </span>
          <span class="dia-fechado-texto">Fechado</span>
        </div>`;
    }).join("");
  }
  function lerHorarios() {
    const h = {};
    for (const div of $$("#listaHorarios .dia")) {
      if (!div.querySelector(".h-on").checked) continue;
      const nome = div.querySelector(".dia-nome").textContent.trim();
      const faixas = [];
      const a1 = div.querySelector(".h-abre1").value, f1 = div.querySelector(".h-fecha1").value;
      if (!HORA_OK.test(a1) || !HORA_OK.test(f1)) throw new Error("Preencha o horário de " + nome + ".");
      if (a1 === f1) throw new Error("Em " + nome + ", o horário de abrir e fechar são iguais.");
      faixas.push({ abre: a1, fecha: f1 });
      const a2 = div.querySelector(".h-abre2").value, f2 = div.querySelector(".h-fecha2").value;
      if (!div.querySelector(".h-segundo").classList.contains("oculto") && (a2 || f2)) {
        if (!HORA_OK.test(a2) || !HORA_OK.test(f2) || a2 === f2) throw new Error("Confira o 2º horário de " + nome + ".");
        faixas.push({ abre: a2, fecha: f2 });
      }
      h[div.dataset.dia] = faixas;
    }
    return h;
  }

  function prepararEntregaHorarios() {
    $$('input[name="modoTaxa"]').forEach(r => r.addEventListener("change", mostrarModoTaxa));
    $("#btnBuscaEndereco").onclick = buscarEndereco;
    $("#lBuscaEndereco").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); buscarEndereco(); } });
    $("#btnLocalLoja").onclick = async () => {
      await U.ocupado($("#btnLocalLoja"), "Procurando…", async () => {
        try {
          const p = await U.minhaLocalizacao();
          await abrirMapaLoja();
          mapaLoja.mover(p.lat, p.lng, true);
          U.toast(p.precisao > 100 ? "Localização aproximada (" + Math.round(p.precisao) + " m). Ajuste o alfinete na porta da loja." : "Confira se o alfinete ficou na porta da loja.");
        } catch (e) { U.toast(e.message, "erro"); }
      });
    };
    $("#btnAddFaixa").onclick = () => {
      const atuais = lerFaixas();
      const ultimo = atuais.length ? atuais[atuais.length - 1] : { ate_km: 0, valor: 0 };
      const nova = { ate_km: Number.isFinite(ultimo.ate_km) ? ultimo.ate_km + 2 : null, valor: Number.isFinite(ultimo.valor) ? ultimo.valor + 2 : null };
      $("#faixaLimite").insertAdjacentHTML("beforebegin", linhaFaixa(nova));
      atualizarLimiteFaixas();
      marcarLoja(true);
    };
    $("#listaFaixas").addEventListener("click", e => {
      const b = e.target.closest("[data-remover-faixa]");
      if (!b) return;
      if ($$("#listaFaixas .faixa").length === 1) return U.toast("Deixe pelo menos uma faixa.", "erro");
      b.closest(".faixa").remove();
      atualizarLimiteFaixas();
      marcarLoja(true);
    });
    $("#listaFaixas").addEventListener("input", atualizarLimiteFaixas);

    $("#lAuto").addEventListener("change", () => $("#blocoHorarios").classList.toggle("oculto", !$("#lAuto").checked));
    $("#listaHorarios").addEventListener("change", e => {
      if (e.target.classList.contains("h-on")) e.target.closest(".dia").classList.toggle("dia-fechado", !e.target.checked);
    });
    $("#listaHorarios").addEventListener("click", e => {
      const b = e.target.closest(".h-mais");
      if (!b) return;
      const dia = b.closest(".dia");
      dia.querySelector(".h-segundo").classList.remove("oculto");
      b.classList.add("oculto");
      if (!dia.querySelector(".h-abre2").value) { dia.querySelector(".h-abre2").value = "18:00"; dia.querySelector(".h-fecha2").value = "23:00"; }
      marcarLoja(true);
    });
    $("#btnCopiarHorario").onclick = () => {
      const dias = $$("#listaHorarios .dia").filter(d => d.querySelector(".h-on").checked);
      if (dias.length < 2) return U.toast("Marque os dias que abrem primeiro.", "erro");
      const base = dias[0];
      dias.slice(1).forEach(d => {
        ["h-abre1", "h-fecha1", "h-abre2", "h-fecha2"].forEach(c => { d.querySelector("." + c).value = base.querySelector("." + c).value; });
        const dois = !base.querySelector(".h-segundo").classList.contains("oculto");
        d.querySelector(".h-segundo").classList.toggle("oculto", !dois);
        d.querySelector(".h-mais").classList.toggle("oculto", dois);
      });
      marcarLoja(true);
      U.toast("Horário copiado. Lembre de salvar.");
    };
  }

  function prepararLoja() {
    $("#btnCopiarLink").onclick = () => U.copiar(urlCardapio());
    $("#papelLargura").value = papelAtual();
    $("#papelLargura").onchange = () => {
      U.gravarLocal("wl_papel", $("#papelLargura").value);
      U.toast("Papel " + $("#papelLargura").value + " mm salvo neste computador");
    };
    $("#btnTesteImpressao").onclick = imprimirTeste;
    const form = $("#formLoja");
    form.addEventListener("submit", e => { e.preventDefault(); salvarLoja(); });
    prepararImagem("#lLogoArquivo", "#lLogo", "#lLogoPrevia", "#lLogoRemover");
    prepararEntregaHorarios();
    const marcar = e => { if (e && e.target && e.target.id === "lBuscaEndereco") return; marcarLoja(true); };
    form.addEventListener("input", marcar);
    form.addEventListener("change", marcar);
    // o upload/remocao da logo altera o campo por codigo
    ["#lLogoRemover"].forEach(sel => $(sel).addEventListener("click", marcar));
    $("#lCor").addEventListener("input", () => { $("#lCorTexto").textContent = $("#lCor").value.toUpperCase(); });
    $("#btnDesfazerLoja").onclick = () => { marcarLoja(false); preencherLoja(); U.toast("Alterações desfeitas"); };
    window.addEventListener("beforeunload", e => { if (lojaAlterada) { e.preventDefault(); e.returnValue = ""; } });
  }

  function marcarLoja(alterada) {
    lojaAlterada = alterada;
    $("#barraSalvar").classList.toggle("alterada", alterada);
    $("#estadoLoja").textContent = alterada ? "Você tem alterações não salvas" : "Tudo salvo";
    $("#btnDesfazerLoja").classList.toggle("oculto", !alterada);
  }

  function preencherLoja() {
    const url = urlCardapio();
    $("#linkCardapio").textContent = url;
    $("#btnAbrirLink").href = url;
    $("#imgQR").classList.toggle("oculto", !!WL.demo);
    $("#btnBaixarQR").classList.toggle("oculto", !!WL.demo);
    if (!WL.demo) $("#imgQR").src = "https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=8&data=" + encodeURIComponent(url);
    $("#btnBaixarQR").href = "https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&margin=20&format=png&data=" + encodeURIComponent(url);
    Alarme.desenharEstado();

    if (lojaAlterada) return; // nao apaga o que a pessoa esta editando

    $("#lNome").value = loja.nome;
    $("#lLogo").value = loja.logo_url || "";
    $("#lLogo").dispatchEvent(new Event("input"));
    $("#lCor").value = loja.cor_primaria;
    $("#lCorTexto").textContent = String(loja.cor_primaria || "").toUpperCase();
    $("#lWhats").value = loja.whatsapp ? U.telefoneBonito(loja.whatsapp) : "";
    $("#lPix").value = loja.chave_pix || "";
    $("#lEndereco").value = loja.endereco || "";
    $("#lTaxa").value = valorTexto(loja.taxa_entrega);
    $("#lMinimo").value = valorTexto(loja.pedido_minimo);
    $("#lDelivery").checked = loja.aceita_delivery;
    $("#lRetirada").checked = loja.aceita_retirada;
    $("#lMesa").checked = loja.aceita_mesa;
    $("#lMsgFechada").value = loja.mensagem_fechada || "";

    // Entrega e horarios (Etapa 2)
    const modo = loja.modo_taxa === "distancia" ? "distancia" : "fixa";
    $$('input[name="modoTaxa"]').forEach(r => { r.checked = r.value === modo; });
    localLoja = loja.latitude != null && loja.longitude != null ? { lat: Number(loja.latitude), lng: Number(loja.longitude) } : null;
    desenharFaixas(Array.isArray(loja.faixas_entrega) ? loja.faixas_entrega : []);
    $("#lExigirLocal").checked = !!loja.exigir_localizacao;
    desenharLocalLoja();
    mostrarModoTaxa();
    $("#lAuto").checked = !!loja.horario_automatico;
    $("#blocoHorarios").classList.toggle("oculto", !loja.horario_automatico);
    desenharHorarios(loja.horarios);
    $("#resultadosEndereco").classList.add("oculto");

    const formas = FORMAS_PADRAO.concat((loja.formas_pagamento || []).filter(f => !FORMAS_PADRAO.includes(f)));
    $("#lFormas").innerHTML = "<legend>Formas de pagamento aceitas</legend>" + formas.map(f =>
      `<label><input type="checkbox" value="${esc(f)}" ${(loja.formas_pagamento || []).includes(f) ? "checked" : ""}> ${esc(f)}</label>`).join("");
    $("#erroLoja").classList.add("oculto");
    marcarLoja(false);
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

    const modo = modoTaxa();
    let faixas = [];
    if (modo === "distancia") {
      if (!localLoja) return erro("Marque no mapa onde fica a loja para cobrar por distância.");
      faixas = lerFaixas();
      if (faixas.some(f => !Number.isFinite(f.ate_km) || f.ate_km <= 0 || f.ate_km > 100)) return erro("Confira os quilômetros das faixas (ex.: 3 ou 2,5).");
      if (faixas.some(f => !Number.isFinite(f.valor) || f.valor < 0)) return erro("Confira os valores das faixas de distância.");
      faixas.sort((a, b) => a.ate_km - b.ate_km);
      if (faixas.some((f, i) => i && f.ate_km === faixas[i - 1].ate_km)) return erro("Há duas faixas com a mesma distância.");
      faixas = faixas.map(f => ({ ate_km: Math.round(f.ate_km * 100) / 100, valor: Math.round(f.valor * 100) / 100 }));
    }
    let horarios = {};
    try { horarios = lerHorarios(); } catch (e) { return erro(e.message); }
    if ($("#lAuto").checked && !Object.keys(horarios).length) return erro("Marque pelo menos um dia de funcionamento.");

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
    // Campos da Etapa 2 so vao se o banco ja tiver as colunas (script 08)
    if ("modo_taxa" in loja) {
      Object.assign(dados, {
        modo_taxa: modo,
        faixas_entrega: modo === "distancia" ? faixas : (Array.isArray(loja.faixas_entrega) ? loja.faixas_entrega : []),
        latitude: localLoja ? localLoja.lat : null,
        longitude: localLoja ? localLoja.lng : null,
        exigir_localizacao: $("#lExigirLocal").checked,
        horario_automatico: $("#lAuto").checked,
        horarios
      });
    } else if (modo === "distancia" || $("#lAuto").checked) {
      return erro("Falta rodar o script 08-etapa2.sql no Supabase para usar distância e horários.");
    }

    await U.ocupado($("#btnSalvarLoja"), "Salvando…", async () => {
      try {
        const r = await WL.atualizar("lojas", { id: "eq." + lojaId }, dados);
        if (!r.length) throw new Error("Sem permissão para alterar a loja.");
        loja = r[0];
        montarCabecalho();
        marcarLoja(false);
        preencherLoja();
        atualizarStatusLoja();
        U.toast("Dados da loja salvos");
      } catch (e) {
        erro(e.message);
      }
    });
  }

  iniciar();
})();
