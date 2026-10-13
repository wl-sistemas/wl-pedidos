// =====================================================================
// WL PEDIDOS - FUNCOES DE APOIO
// =====================================================================
(function () {
  const formatoMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  const U = {
    $(sel, raiz) { return (raiz || document).querySelector(sel); },
    $$(sel, raiz) { return Array.from((raiz || document).querySelectorAll(sel)); },

    moeda(v) { return formatoMoeda.format(Number(v || 0)); },

    // Escapa texto antes de colocar em HTML (evita injecao de codigo)
    esc(t) {
      return String(t == null ? "" : t)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    },

    param(nome) { return new URLSearchParams(location.search).get(nome); },

    numero(v) {
      if (v === null || v === undefined) return null;
      const s = String(v).trim().replace(/\s/g, "").replace(/^R\$/i, "");
      if (s === "") return null;
      const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
      const n = Number(normal);
      return Number.isFinite(n) ? n : NaN;
    },

    // Celular brasileiro -> formato do WhatsApp (55 + DDD + numero), sem duplicar o 55
    whatsappNumero(tel) {
      let d = String(tel || "").replace(/\D/g, "");
      if (!d) return "";
      if (d.length >= 12 && d.startsWith("55")) return d;
      if (d.length === 10 || d.length === 11) return "55" + d;
      return d;
    },
    linkWhatsapp(tel, mensagem) {
      const n = U.whatsappNumero(tel);
      const texto = mensagem ? "?text=" + encodeURIComponent(mensagem) : "";
      return n ? "https://wa.me/" + n + texto : "https://wa.me/" + texto;
    },
    telefoneBonito(tel) {
      const d = String(tel || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
      if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
      if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
      return tel || "";
    },

    hora(iso) {
      return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    },
    dataHora(iso) {
      return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    },
    haQuanto(iso) {
      const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
      if (min < 1) return "agora";
      if (min < 60) return "há " + min + " min";
      const h = Math.floor(min / 60);
      return "há " + h + " h" + (min % 60 ? " " + (min % 60) + " min" : "");
    },
    // Data de hoje (AAAA-MM-DD) no fuso da loja
    hojeNoFuso(fuso) {
      try {
        return new Intl.DateTimeFormat("en-CA", { timeZone: fuso || "America/Sao_Paulo" }).format(new Date());
      } catch (e) {
        return new Date().toISOString().slice(0, 10);
      }
    },

    slug(texto) {
      return String(texto || "")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    },

    // Aplica a cor da loja e calcula a cor do texto sobre ela
    aplicarCor(hex) {
      const cor = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#0f766e";
      const r = parseInt(cor.slice(1, 3), 16), g = parseInt(cor.slice(3, 5), 16), b = parseInt(cor.slice(5, 7), 16);
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const raiz = document.documentElement.style;
      raiz.setProperty("--cor", cor);
      raiz.setProperty("--cor-texto", lum > 0.62 ? "#1c1b1a" : "#ffffff");
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", cor);
    },

    toast(msg, tipo) {
      let box = document.getElementById("wl-toast");
      if (!box) {
        box = document.createElement("div");
        box.id = "wl-toast";
        box.setAttribute("role", "status");
        box.setAttribute("aria-live", "polite");
        document.body.appendChild(box);
      }
      box.textContent = msg;
      box.className = "mostrar" + (tipo === "erro" ? " erro" : "");
      clearTimeout(U._toastTimer);
      U._toastTimer = setTimeout(() => { box.className = ""; }, tipo === "erro" ? 4500 : 2600);
    },

    async copiar(texto) {
      try {
        await navigator.clipboard.writeText(texto);
      } catch (e) {
        const t = document.createElement("textarea");
        t.value = texto; document.body.appendChild(t); t.select();
        try { document.execCommand("copy"); } catch (e2) { /* ignorar */ }
        t.remove();
      }
      U.toast("Copiado");
    },

    lerLocal(chave, padrao) {
      try { const v = JSON.parse(localStorage.getItem(chave)); return v == null ? padrao : v; } catch (e) { return padrao; }
    },
    gravarLocal(chave, valor) {
      try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* ignorar */ }
    },

    // Janela de confirmacao/pergunta propria (os dialogos do navegador
    // nao funcionam em todo lugar, ex.: dentro de apps e visualizadores)
    dialogo(opcoes) {
      return new Promise(resolve => {
        const d = document.createElement("dialog");
        d.className = "modal modal-p wl-dialogo";
        d.innerHTML = `
          <form method="dialog">
            <div class="modal-corpo">
              <p class="wl-dialogo-texto"></p>
              ${opcoes.campo !== undefined ? '<input class="wl-dialogo-campo" maxlength="80">' : ""}
            </div>
            <footer class="modal-rodape">
              <button type="button" class="btn" data-r="nao">${U.esc(opcoes.cancelar || "Cancelar")}</button>
              <button type="submit" class="btn ${opcoes.perigo ? "btn-perigo" : "btn-escuro"}" data-r="sim">${U.esc(opcoes.ok || "Confirmar")}</button>
            </footer>
          </form>`;
        d.querySelector(".wl-dialogo-texto").textContent = opcoes.texto;
        const campo = d.querySelector(".wl-dialogo-campo");
        if (campo) campo.value = opcoes.campo || "";
        let resposta = null;
        d.querySelector('[data-r="nao"]').onclick = () => d.close();
        d.querySelector("form").addEventListener("submit", () => { resposta = campo ? campo.value.trim() : true; });
        d.addEventListener("close", () => { d.remove(); resolve(resposta); });
        document.body.appendChild(d);
        d.showModal();
        (campo || d.querySelector('[data-r="sim"]')).focus();
        if (campo) campo.select();
      });
    },
    confirmar(texto, ok, perigo) { return U.dialogo({ texto, ok, perigo }).then(r => r === true); },
    perguntar(texto, valor, ok) { return U.dialogo({ texto, campo: valor || "", ok: ok || "Salvar" }); },

    // Abre um link em outra aba a partir de um clique
    abrirLink(url) {
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
    },

    // Botao em estado "carregando"
    async ocupado(botao, texto, fn) {
      const original = botao ? botao.innerHTML : "";
      if (botao) { botao.disabled = true; botao.textContent = texto; }
      try { return await fn(); }
      finally { if (botao) { botao.disabled = false; botao.innerHTML = original; } }
    },

    // Fluxo de status por tipo de atendimento
    etapas(tipo) {
      return tipo === "Delivery"
        ? ["Recebido", "Em preparo", "Saiu para entrega", "Finalizado"]
        : ["Recebido", "Em preparo", "Pronto", "Finalizado"];
    },
    rotuloTipo(p) {
      if (p.tipo_atendimento === "Delivery") return "Entrega";
      if (p.tipo_atendimento === "Retirada") return "Retirada";
      return "Mesa " + (p.mesa || "");
    },

    resumoOpcoes(opcoes) {
      if (!Array.isArray(opcoes) || !opcoes.length) return "";
      const grupos = {};
      opcoes.forEach(o => { (grupos[o.grupo] = grupos[o.grupo] || []).push(o.nome); });
      return Object.entries(grupos).map(([g, n]) => g + ": " + n.join(", ")).join(" | ");
    }
  };

  window.U = U;
})();
