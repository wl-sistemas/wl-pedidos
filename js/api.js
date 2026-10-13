// =====================================================================
// WL PEDIDOS - CONEXAO COM O SUPABASE
// Cliente leve usando fetch (sem bibliotecas externas).
// Fala direto com as APIs REST, Auth e Storage do Supabase.
// =====================================================================
(function () {
  const C = window.WL_CONFIG || {};
  const BASE = String(C.supabaseUrl || "").replace(/\/+$/, "");
  const CHAVE_SESSAO = "wl_sessao";

  function lerSessao() {
    try { return JSON.parse(localStorage.getItem(CHAVE_SESSAO)); } catch (e) { return null; }
  }
  function gravarSessao(s) {
    sessao = s;
    try {
      if (s) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
      else localStorage.removeItem(CHAVE_SESSAO);
    } catch (e) { /* navegador sem armazenamento: sessao fica so na memoria */ }
  }
  function normalizar(d) {
    const agora = Math.floor(Date.now() / 1000);
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at || agora + Number(d.expires_in || 3600),
      user: d.user ? { id: d.user.id, email: d.user.email } : null
    };
  }

  let sessao = lerSessao();
  let renovando = null;

  function traduzirErro(dados, status) {
    const msg = (dados && (dados.message || dados.msg || dados.error_description || dados.error)) ||
                (typeof dados === "string" ? dados : "");
    if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
    if (/email not confirmed/i.test(msg)) return "Este e-mail ainda não foi confirmado.";
    if (/jwt expired|invalid jwt|refresh token/i.test(msg)) return "Sua sessão expirou. Entre novamente.";
    if (/permission denied|row-level security/i.test(msg)) return "Sem permissão para esta ação.";
    if (/duplicate key/i.test(msg)) return "Já existe um registro com esses dados.";
    if (/violates check constraint/i.test(msg)) return "Algum campo está com valor inválido.";
    if (msg) return msg;
    return status ? "Erro " + status + " ao falar com o servidor." : "Erro ao falar com o servidor.";
  }

  async function chamar(url, opcoes) {
    let r;
    try {
      r = await fetch(url, opcoes);
    } catch (e) {
      throw new Error("Sem conexão. Verifique a internet e tente de novo.");
    }
    const texto = await r.text();
    let dados = null;
    if (texto) { try { dados = JSON.parse(texto); } catch (e) { dados = texto; } }
    if (!r.ok) {
      if (r.status === 401 && sessao) gravarSessao(null);
      const erro = new Error(traduzirErro(dados, r.status));
      erro.status = r.status;
      throw erro;
    }
    return dados;
  }

  async function renovarSessao() {
    if (!sessao || !sessao.refresh_token) return;
    if (!renovando) {
      renovando = chamar(BASE + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { apikey: C.supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: sessao.refresh_token })
      }).then(d => gravarSessao(normalizar(d)))
        .catch(() => gravarSessao(null))
        .finally(() => { renovando = null; });
    }
    await renovando;
  }

  async function tokenAtual() {
    if (!sessao) return null;
    if ((sessao.expires_at * 1000) - Date.now() < 60 * 1000) await renovarSessao();
    return sessao ? sessao.access_token : null;
  }

  async function cabecalhos(extra) {
    const h = Object.assign({ apikey: C.supabaseKey, "Content-Type": "application/json" }, extra || {});
    const t = await tokenAtual();
    if (t) h.Authorization = "Bearer " + t;
    return h;
  }

  async function rest(metodo, caminho, corpo, extra) {
    return chamar(BASE + caminho, {
      method: metodo,
      headers: await cabecalhos(extra),
      body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
  }

  // Monta filtros no formato do Supabase: {loja_id: "eq.xxx", order: "ordem,id"}
  function montarQuery(params) {
    return Object.entries(params || {})
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
      .join("&");
  }

  window.WL = {
    configurado() {
      return /^https?:\/\/.+/.test(BASE) && !/SEU-PROJETO/.test(BASE) &&
             C.supabaseKey && !/COLE_AQUI/.test(C.supabaseKey);
    },

    // ----- Autenticacao -----
    logado() { return !!sessao; },
    usuario() { return sessao ? sessao.user : null; },
    async entrar(email, senha) {
      const d = await chamar(BASE + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { apikey: C.supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(email).trim(), password: senha })
      });
      gravarSessao(normalizar(d));
      return sessao.user;
    },
    async sair() {
      const t = sessao ? sessao.access_token : null;
      gravarSessao(null);
      if (t) {
        try {
          await fetch(BASE + "/auth/v1/logout", {
            method: "POST", headers: { apikey: C.supabaseKey, Authorization: "Bearer " + t }
          });
        } catch (e) { /* ignorar */ }
      }
    },
    async garantirSessao() {
      await tokenAtual();
      return !!sessao;
    },

    // ----- Banco -----
    rpc(funcao, args) {
      return rest("POST", "/rest/v1/rpc/" + funcao, args || {});
    },
    listar(tabela, params) {
      return rest("GET", "/rest/v1/" + tabela + "?" + montarQuery(params));
    },
    inserir(tabela, dados) {
      return rest("POST", "/rest/v1/" + tabela, dados, { Prefer: "return=representation" });
    },
    atualizar(tabela, filtros, dados) {
      return rest("PATCH", "/rest/v1/" + tabela + "?" + montarQuery(filtros), dados,
                  { Prefer: "return=representation" });
    },
    excluir(tabela, filtros) {
      return rest("DELETE", "/rest/v1/" + tabela + "?" + montarQuery(filtros), undefined,
                  { Prefer: "return=representation" });
    },

    // ----- Imagens -----
    async enviarImagem(caminho, arquivo) {
      const t = await tokenAtual();
      if (!t) throw new Error("Entre novamente para enviar imagens.");
      await chamar(BASE + "/storage/v1/object/imagens/" + caminho, {
        method: "POST",
        headers: {
          apikey: C.supabaseKey,
          Authorization: "Bearer " + t,
          "Content-Type": arquivo.type || "application/octet-stream",
          "x-upsert": "false"
        },
        body: arquivo
      });
      return BASE + "/storage/v1/object/public/imagens/" + caminho;
    }
  };
})();
