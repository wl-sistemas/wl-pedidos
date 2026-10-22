// =====================================================================
// WL PEDIDOS - PAGINA DO ENTREGADOR
// Link enviado pela loja no WhatsApp: entregador.html?t=<token>
// Sem login: o link e a "chave" desta entrega.
// =====================================================================
(function () {
  const { $, esc, moeda } = U;
  const token = (U.param("t") || "").trim();
  let dados = null;
  let timer = null;

  function erro(texto) {
    $("#carregando").classList.add("oculto");
    $("#app").classList.add("oculto");
    $("#barraAcao").classList.add("oculto");
    $("#erroTexto").textContent = texto;
    $("#erroTela").classList.remove("oculto");
  }

  async function carregar(primeira) {
    try {
      const r = await WL.rpc("entrega_publica", { p_token: token });
      if (!r) return erro("Confira o link com a loja.");
      dados = r;
      mostrar();
    } catch (e) {
      if (primeira) erro(e.message);
    }
    clearTimeout(timer);
    // confere de tempos em tempos (a loja pode cancelar ou trocar o entregador)
    if (dados && dados.status !== "Entregue" && dados.status !== "Cancelada") timer = setTimeout(() => carregar(false), 20000);
  }

  function linkMapa(p) {
    if (p.latitude != null) return U.linkMapa(p.latitude, p.longitude);
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(p.endereco || "");
  }
  function linkWaze(p) {
    if (p.latitude != null) return "https://waze.com/ul?ll=" + p.latitude + "," + p.longitude + "&navigate=yes";
    return "https://waze.com/ul?q=" + encodeURIComponent(p.endereco || "") + "&navigate=yes";
  }

  function mostrar() {
    const d = dados, p = d.pedido, l = d.loja;
    U.aplicarCor(l.cor_primaria);
    document.title = "Entrega #" + p.numero + " | " + l.nome;
    $("#lojaNome").textContent = l.nome;
    if (l.logo_url) { $("#lojaLogo").src = l.logo_url; $("#lojaLogo").classList.remove("oculto"); }
    $("#pedidoInfo").textContent = "Pedido #" + p.numero + " · " + d.entregador.split(" ")[0];

    const cancelado = d.status === "Cancelada" || p.status === "Cancelado";
    const st = $("#entStatus");
    st.className = "ent-status" + (d.status === "Entregue" ? " ok" : cancelado ? " ruim" : "");
    st.textContent = p.status === "Cancelado" ? "Pedido cancelado pela loja. Não entregue."
      : d.status === "Cancelada" ? "Esta entrega foi passada para outro entregador."
      : d.status === "Entregue" ? "Entregue às " + U.hora(d.entregue_em) + ". Obrigado!"
      : d.status === "A caminho" ? "A caminho do cliente"
      : "Nova entrega: retire o pedido na loja";

    $("#cliNome").textContent = p.cliente_nome;
    const tel = String(p.telefone || "").replace(/\D/g, "");
    $("#btnLigar").href = tel ? "tel:+55" + tel.replace(/^55(?=\d{10,11}$)/, "") : "#";
    $("#btnLigar").classList.toggle("oculto", !tel);
    $("#btnZapCliente").classList.toggle("oculto", !tel);
    $("#btnZapCliente").href = U.linkWhatsapp(p.telefone, "Olá, " + p.cliente_nome.split(" ")[0] + "! Sou o entregador da " + l.nome + " com o seu pedido #" + p.numero + ".");

    $("#cliEndereco").textContent = p.endereco || "Endereço não informado";
    $("#cliKm").textContent = p.distancia_km != null ? "Cerca de " + U.km(p.distancia_km) + " da loja (em linha reta)" + (p.latitude != null ? " · local marcado pelo cliente no mapa" : "") : "";
    $("#btnMaps").href = linkMapa(p);
    $("#btnWaze").href = linkWaze(p);

    const cobrar = Number(d.cobrar || 0);
    const bloco = $("#blocoCobrar");
    bloco.classList.toggle("pago", cobrar <= 0);
    const pix = d.forma_pagamento === "Pix";
    bloco.classList.toggle("pix", cobrar > 0 && pix);
    if (cobrar > 0 && pix) {
      $("#cobrarTitulo").textContent = "Pagamento por Pix";
      $("#cobrarValor").textContent = moeda(cobrar);
      $("#cobrarForma").textContent = d.status === "Entregue" ? "A loja confere o Pix." : "Confirme com a loja se o Pix já caiu antes de cobrar do cliente.";
    } else if (cobrar > 0) {
      $("#cobrarTitulo").textContent = d.status === "Entregue" ? "Recebido do cliente" : "Cobrar do cliente";
      $("#cobrarValor").textContent = moeda(cobrar);
      let forma = d.forma_pagamento || "Forma de pagamento não informada";
      if (d.forma_pagamento === "Dinheiro" && p.troco_para) {
        forma += " · troco para " + moeda(p.troco_para) + " (levar " + moeda(Number(p.troco_para) - cobrar) + " de troco)";
      }
      $("#cobrarForma").textContent = forma;
    } else {
      $("#cobrarTitulo").textContent = "Pagamento";
      $("#cobrarValor").textContent = "Já pago";
      $("#cobrarForma").textContent = "Não cobrar nada do cliente.";
    }

    $("#listaItens").innerHTML = p.itens.map(i => `
      <li><b>${i.quantidade}x</b> ${esc(i.nome)}${i.tamanho ? " (" + esc(i.tamanho) + ")" : ""}
        ${U.resumoOpcoes(i.opcoes) ? `<small>${esc(U.resumoOpcoes(i.opcoes))}</small>` : ""}
        ${i.observacao ? `<small>Obs: ${esc(i.observacao)}</small>` : ""}</li>`).join("");
    $("#pedidoObs").classList.toggle("oculto", !p.observacao);
    $("#pedidoObs").textContent = p.observacao ? "Obs. do pedido: " + p.observacao : "";

    $("#entGanho").innerHTML = "Você recebe por esta entrega: <b>" + moeda(d.valor_entregador) + "</b>";
    $("#btnZapLoja").href = U.linkWhatsapp(l.whatsapp, "Sobre a entrega do pedido #" + p.numero + " (" + p.cliente_nome + ")");
    $("#btnZapLoja").classList.toggle("oculto", !l.whatsapp);

    // Botao principal
    const barra = $("#barraAcao");
    const fim = cancelado || d.status === "Entregue";
    barra.classList.toggle("oculto", fim);
    $("#codigoEntrega").classList.toggle("oculto", !(d.status === "A caminho" && d.precisa_codigo));
    $("#btnAcao").textContent = d.status === "Enviada" ? "🛵 Saí para entrega" : "✅ Entreguei";
    $("#btnAcao").dataset.acao = d.status === "Enviada" ? "saiu" : "entregue";

    $("#carregando").classList.add("oculto");
    $("#app").classList.remove("oculto");
  }

  async function agir() {
    const acao = $("#btnAcao").dataset.acao;
    const caixaErro = $("#erroAcao");
    caixaErro.classList.add("oculto");
    let codigo = null;
    if (acao === "entregue" && dados.precisa_codigo) {
      codigo = $("#codigoEntrega").value.replace(/\D/g, "");
      if (codigo.length !== 4) {
        caixaErro.textContent = "Digite o código de 4 números que o cliente tem no pedido.";
        caixaErro.classList.remove("oculto");
        $("#codigoEntrega").focus();
        return;
      }
    }
    if (acao === "entregue" && !dados.precisa_codigo && Number(dados.cobrar) > 0 &&
        !(await U.confirmar("Confirmar que entregou e recebeu " + moeda(dados.cobrar) + " do cliente?", "Entreguei"))) return;

    const botao = $("#btnAcao");
    botao.disabled = true;
    botao.textContent = "Enviando…";
    try {
      {
        const r = await WL.rpc("entrega_atualizar", { p_token: token, p_acao: acao, p_codigo: codigo });
        if (!r.ok) {
          caixaErro.textContent = r.erro;
          caixaErro.classList.remove("oculto");
          return;
        }
        dados = r.entrega;
        mostrar();
        U.toast(acao === "saiu" ? "Boa entrega!" : "Entrega concluída!");
        if (acao === "saiu") window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) {
      caixaErro.textContent = e.message;
      caixaErro.classList.remove("oculto");
      carregar(false);
    } finally {
      botao.disabled = false;
      if (dados) mostrar();
    }
  }

  $("#btnAcao").addEventListener("click", agir);
  $("#codigoEntrega").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); });

  if (!WL.configurado()) erro("Sistema não configurado.");
  else if (!/^[0-9a-f-]{36}$/i.test(token)) erro("Confira o link com a loja.");
  else carregar(true);
})();
