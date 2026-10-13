// =====================================================================
// WL PEDIDOS - ACOMPANHAMENTO DO PEDIDO
// Link: acompanhar.html?t=<token>
// =====================================================================
(function () {
  const { $, esc, moeda } = U;
  const token = (U.param("t") || (WL.demo ? U.lerLocal("wl_demo_ultimo_token", "") : "")).trim();
  const MENSAGENS = {
    "Recebido": "A loja recebeu seu pedido.",
    "Em preparo": "Seu pedido está sendo preparado.",
    "Saiu para entrega": "Seu pedido saiu para entrega.",
    "Pronto": "Seu pedido está pronto.",
    "Finalizado": "Pedido finalizado. Bom apetite!",
    "Cancelado": "Este pedido foi cancelado."
  };
  let timer = null;

  function erro(texto) {
    $("#carregando").classList.add("oculto");
    $("#app").classList.add("oculto");
    $("#erroTexto").textContent = texto;
    $("#erroTela").classList.remove("oculto");
  }

  async function carregar(primeira) {
    let p;
    try {
      p = await WL.rpc("acompanhar_pedido", { p_token: token });
    } catch (e) {
      if (primeira) erro(e.message);
      return;
    }
    if (!p) return erro("Confira se o link está completo.");
    mostrar(p);
    const final = p.status === "Finalizado" || p.status === "Cancelado";
    clearTimeout(timer);
    if (!final) timer = setTimeout(() => carregar(false), 15000);
  }

  function mostrar(p) {
    U.aplicarCor(p.loja.cor_primaria);
    document.title = "Pedido #" + p.numero + " | " + p.loja.nome;
    $("#lojaNome").textContent = p.loja.nome;
    if (p.loja.logo_url) {
      $("#lojaLogo").src = p.loja.logo_url;
      $("#lojaLogo").classList.remove("oculto");
    }
    $("#pedidoHora").textContent = "Feito em " + U.dataHora(p.criado_em);
    $("#pedidoNumero").textContent = "#" + p.numero;
    $("#pedidoStatus").textContent = MENSAGENS[p.status] || p.status;

    const motivo = $("#pedidoMotivo");
    motivo.classList.toggle("oculto", !(p.status === "Cancelado" && p.motivo_cancelamento));
    motivo.textContent = p.motivo_cancelamento ? "Motivo: " + p.motivo_cancelamento : "";

    const etapas = U.etapas(p.tipo_atendimento);
    const pos = etapas.indexOf(p.status);
    $("#etapas").classList.toggle("oculto", p.status === "Cancelado");
    $("#etapas").innerHTML = etapas.map((e, i) =>
      `<li class="etapa ${i < pos ? "feita" : ""} ${i === pos ? "atual feita" : ""}">${esc(e)}</li>`).join("");

    $("#listaItens").innerHTML = p.itens.map(i => `
      <li class="item">
        <span class="item-nome">${i.quantidade}x ${esc(i.nome)}</span>
        <span>${moeda(i.total)}</span>
        ${i.tamanho ? `<span class="item-detalhe">${esc(i.tamanho)}</span>` : ""}
        ${U.resumoOpcoes(i.opcoes) ? `<span class="item-detalhe">${esc(U.resumoOpcoes(i.opcoes))}</span>` : ""}
      </li>`).join("");

    $("#linhaTaxa").classList.toggle("oculto", !(Number(p.taxa_entrega) > 0));
    $("#valTaxa").textContent = moeda(p.taxa_entrega);
    $("#valTotal").textContent = moeda(p.total);
    $("#linhaPagamento").textContent = p.pagamento ? "Pagamento: " + p.pagamento : "";

    const zap = $("#btnWhatsapp");
    zap.classList.toggle("oculto", !p.loja.whatsapp);
    zap.href = U.linkWhatsapp(p.loja.whatsapp, "Olá! Sobre o meu pedido #" + p.numero + " (" + p.cliente_nome + ")");
    $("#btnCardapio").href = "cardapio.html?loja=" + encodeURIComponent(p.loja.slug);
    $("#atualizado").textContent = "Atualizado às " + U.hora(new Date().toISOString()) +
      (p.status === "Finalizado" || p.status === "Cancelado" ? "" : ". Esta página se atualiza sozinha.");

    $("#carregando").classList.add("oculto");
    $("#app").classList.remove("oculto");
  }

  if (!WL.configurado()) erro("Sistema não configurado.");
  else if (!/^[0-9a-f-]{36}$/i.test(token)) erro("Confira se o link está completo.");
  else carregar(true);
})();
