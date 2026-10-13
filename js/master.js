// =====================================================================
// WL PEDIDOS - PAINEL MASTER (WL Sistemas)
// Criar lojas, ativar/suspender e dar acesso aos donos.
// =====================================================================
(function () {
  const { $, $$, esc, moeda } = U;
  const C = window.WL_CONFIG || {};
  let lojas = [];
  let slugEditado = false;

  async function iniciar() {
    if (!WL.configurado()) { document.body.innerHTML = '<p class="aviso erro" style="margin:24px">Sistema não configurado. Preencha o config.js.</p>'; return; }
    if (!WL.logado() || !(await WL.garantirSessao())) { location.href = "login.html"; return; }
    try {
      if (!(await WL.rpc("is_super_admin"))) { location.href = "painel.html"; return; }
    } catch (e) {
      location.href = "login.html";
      return;
    }

    $("#marca").textContent = C.nomeSistema || "WL Pedidos";
    $("#btnSair").onclick = async () => { await WL.sair(); location.href = "login.html"; };

    $("#nNome").addEventListener("input", () => {
      if (!slugEditado) $("#nSlug").value = U.slug($("#nNome").value);
      previaSlug();
    });
    $("#nSlug").addEventListener("input", () => { slugEditado = true; previaSlug(); });
    $("#formNova").addEventListener("submit", e => { e.preventDefault(); criarLoja(); });
    $("#listaLojas").addEventListener("click", aoClicar);
    $("#listaLojas").addEventListener("submit", aoEnviarAcesso);

    await carregar();
    $("#carregando").classList.add("oculto");
    $("#app").classList.remove("oculto");
  }

  function urlCardapio(slug) {
    return new URL("cardapio.html?loja=" + encodeURIComponent(slug), location.href).href;
  }

  function previaSlug() {
    const s = $("#nSlug").value.trim();
    $("#nPrevia").textContent = s ? urlCardapio(s) : "Só letras minúsculas, números e hífen.";
  }

  async function carregar() {
    try {
      lojas = await WL.rpc("master_listar_lojas");
      desenhar();
    } catch (e) {
      $("#listaLojas").innerHTML = '<p class="aviso erro">' + esc(e.message) + "</p>";
    }
  }

  function desenhar() {
    const ativas = lojas.filter(l => l.ativa).length;
    const vendas = lojas.reduce((s, l) => s + Number(l.vendas_30d || 0), 0);
    $("#resumo").textContent = lojas.length
      ? `${lojas.length} ${lojas.length === 1 ? "loja" : "lojas"}, ${ativas} ${ativas === 1 ? "ativa" : "ativas"}. Vendas das lojas nos últimos 30 dias: ${moeda(vendas)}.`
      : "Nenhuma loja ainda. Crie a primeira abaixo.";

    $("#listaLojas").innerHTML = lojas.map(l => `
      <article class="cartao loja-item ${l.ativa ? "" : "loja-suspensa"}" data-loja="${esc(l.id)}">
        <header class="loja-item-topo">
          <div>
            <h3>${esc(l.nome)} ${l.ativa ? "" : '<span class="etiqueta etiqueta-perigo">Suspensa</span>'}</h3>
            <a href="${esc(urlCardapio(l.slug))}" target="_blank" rel="noopener" class="loja-link">${esc(urlCardapio(l.slug))}</a>
          </div>
          <div class="loja-numeros">
            <span><b>${l.pedidos_30d}</b> pedidos em 30 dias</span>
            <span><b>${moeda(l.vendas_30d)}</b> vendidos</span>
          </div>
        </header>

        <div class="loja-acessos">
          <p class="texto-suave">Quem acessa o painel:</p>
          ${l.membros.length ? `<ul>${l.membros.map(m => `
            <li>${esc(m.email)} <span class="etiqueta">${m.papel === "dono" ? "Dono" : "Atendente"}</span>
              <button class="btn btn-p btn-texto btn-perigo" type="button" data-acao="remover" data-user="${esc(m.user_id)}" data-email="${esc(m.email)}">Remover</button></li>`).join("")}</ul>`
            : '<p class="aviso">Ninguém ainda. Dê acesso ao dono para ele entrar no painel.</p>'}
          <form class="form-acesso" novalidate>
            <input type="email" name="email" placeholder="e-mail do usuário" aria-label="E-mail do usuário" required>
            <select name="papel" aria-label="Papel"><option value="dono">Dono</option><option value="atendente">Atendente</option></select>
            <button class="btn btn-p btn-escuro" type="submit">Dar acesso</button>
          </form>
        </div>

        <div class="linha-botoes">
          <a class="btn btn-p" href="painel.html?loja=${esc(l.id)}">Abrir painel</a>
          <button class="btn btn-p" type="button" data-acao="slug">Mudar link</button>
          <button class="btn btn-p ${l.ativa ? "btn-perigo" : "btn-ok"}" type="button" data-acao="ativa">${l.ativa ? "Suspender" : "Reativar"}</button>
        </div>
      </article>`).join("");
  }

  async function criarLoja() {
    const erro = m => { $("#erroNova").textContent = m; $("#erroNova").classList.remove("oculto"); };
    $("#erroNova").classList.add("oculto");
    const nome = $("#nNome").value.trim();
    const slug = $("#nSlug").value.trim().toLowerCase();
    if (nome.length < 2) return erro("Informe o nome da loja.");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3) return erro("Link inválido. Use só letras minúsculas, números e hífen (mínimo 3).");
    await U.ocupado($("#btnCriar"), "Criando…", async () => {
      try {
        await WL.rpc("master_criar_loja", { p_nome: nome, p_slug: slug });
        $("#nNome").value = ""; $("#nSlug").value = ""; slugEditado = false; previaSlug();
        U.toast("Loja criada");
        await carregar();
      } catch (e) { erro(e.message); }
    });
  }

  async function aoClicar(e) {
    const b = e.target.closest("[data-acao]");
    if (!b) return;
    const l = lojas.find(x => x.id === b.closest("[data-loja]").dataset.loja);
    try {
      if (b.dataset.acao === "ativa") {
        const msg = l.ativa
          ? `Suspender "${l.nome}"? O cardápio sai do ar e ninguém consegue pedir até reativar.`
          : `Reativar "${l.nome}"?`;
        if (!(await U.confirmar(msg, l.ativa ? "Suspender" : "Reativar", l.ativa))) return;
        await WL.rpc("master_atualizar_loja", { p_loja: l.id, p_ativa: !l.ativa, p_slug: null });
        U.toast(l.ativa ? "Loja suspensa" : "Loja reativada");
      } else if (b.dataset.acao === "slug") {
        const novo = (await U.perguntar("Novo link (o link antigo para de funcionar):", l.slug, "Mudar link") || "").trim().toLowerCase();
        if (!novo || novo === l.slug) return;
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(novo) || novo.length < 3) { U.toast("Link inválido.", "erro"); return; }
        await WL.rpc("master_atualizar_loja", { p_loja: l.id, p_ativa: null, p_slug: novo });
        U.toast("Link alterado");
      } else if (b.dataset.acao === "remover") {
        if (!(await U.confirmar("Tirar o acesso de " + b.dataset.email + " a esta loja?", "Remover acesso", true))) return;
        await WL.rpc("master_remover_usuario", { p_loja: l.id, p_user: b.dataset.user });
        U.toast("Acesso removido");
      }
      await carregar();
    } catch (err) {
      U.toast(err.message, "erro");
    }
  }

  async function aoEnviarAcesso(e) {
    e.preventDefault();
    const form = e.target;
    const l = lojas.find(x => x.id === form.closest("[data-loja]").dataset.loja);
    const email = form.email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { U.toast("Informe um e-mail válido.", "erro"); return; }
    await U.ocupado($("button", form), "Salvando…", async () => {
      try {
        await WL.rpc("master_vincular_usuario", { p_loja: l.id, p_email: email, p_papel: form.papel.value });
        U.toast("Acesso liberado para " + email);
        await carregar();
      } catch (err) {
        U.toast(err.message, "erro");
      }
    });
  }

  iniciar();
})();
