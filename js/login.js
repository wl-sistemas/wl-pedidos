// =====================================================================
// WL PEDIDOS - LOGIN
// Super admin -> painel master; dono/atendente -> painel da loja.
// =====================================================================
(function () {
  const { $, esc } = U;
  const C = window.WL_CONFIG || {};

  $("#marca").textContent = C.nomeSistema || "WL Pedidos";
  if (WL.demo) {
    const dica = document.createElement("p");
    dica.className = "aviso";
    dica.innerHTML = "<b>Demonstração.</b> Loja: <b>dono@demo.com</b>. WL Sistemas (todas as lojas): <b>wl@demo.com</b>. Senha: <b>123456</b>.";
    $("#formLogin").prepend(dica);
  }
  $("#linkSuporte").href = U.linkWhatsapp(C.suporteWhatsapp, "Olá! Preciso de ajuda para entrar no painel.");

  function mostrarErro(msg) {
    $("#erro").textContent = msg;
    $("#erro").classList.remove("oculto");
  }

  async function direcionar() {
    const [superAdmin, lojas] = await Promise.all([
      WL.rpc("is_super_admin"),
      WL.listar("lojas", { select: "id,nome,slug", order: "nome" })
    ]);
    if (superAdmin) {
      location.href = "master.html";
      return;
    }
    if (!lojas.length) {
      await WL.sair();
      mostrarErro("Seu usuário ainda não está ligado a nenhuma loja. Fale com o suporte.");
      return;
    }
    if (lojas.length === 1) {
      location.href = "painel.html?loja=" + lojas[0].id;
      return;
    }
    $("#formLogin").classList.add("oculto");
    $("#escolherLoja").classList.remove("oculto");
    $("#listaLojas").innerHTML = lojas.map(l =>
      `<a class="btn btn-bloco" href="painel.html?loja=${esc(l.id)}">${esc(l.nome)}</a>`).join("");
  }

  $("#formLogin").addEventListener("submit", async e => {
    e.preventDefault();
    $("#erro").classList.add("oculto");
    if (!WL.configurado()) return mostrarErro("Sistema não configurado. Preencha o arquivo config.js.");
    const email = $("#email").value.trim();
    const senha = $("#senha").value;
    if (!email || !senha) return mostrarErro("Informe e-mail e senha.");
    await U.ocupado($("#btnEntrar"), "Entrando…", async () => {
      try {
        await WL.entrar(email, senha);
        await direcionar();
      } catch (err) {
        mostrarErro(err.message);
      }
    });
  });

  $("#btnSairEscolha").onclick = async () => {
    await WL.sair();
    location.reload();
  };

  // Ja logado? Vai direto.
  (async () => {
    if (WL.configurado() && WL.logado() && await WL.garantirSessao()) {
      try { await direcionar(); } catch (e) { /* mostra o formulario */ }
    }
  })();
})();
