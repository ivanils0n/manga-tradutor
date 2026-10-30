// Roda em toda página: escuta os atalhos e desenha a seleção, os avisos e os balões traduzidos.
// Depende de atalhos.js (carregado antes).
if (!window.__mangaTradutor) {
  window.__mangaTradutor = true;

  let atalhos = { ...ATALHOS_PADRAO };
  lerAtalhos().then((a) => (atalhos = a));
  chrome.storage.onChanged.addListener((c) => c.atalhos && lerAtalhos().then((a) => (atalhos = a)));

  const editavel = (el) => el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || "");
  const apertadas = new Set();
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    apertadas.add(nomeTecla(e));
    for (const [acao, combo] of Object.entries(atalhos)) {
      if (!combo?.length || !mesmoCombo(combo, [...apertadas])) continue;
      // atalho sem Ctrl/Alt/Meta não dispara enquanto o usuário digita
      if (editavel(e.target) && !combo.some((t) => ["Ctrl", "Alt", "Meta"].includes(t))) return;
      e.preventDefault();
      e.stopPropagation();
      apertadas.clear(); // o keyup pode não chegar (a seleção rouba o foco)
      chrome.runtime.sendMessage({ acao });
      return;
    }
  }, true);
  addEventListener("keyup", (e) => apertadas.delete(nomeTecla(e)), true);
  addEventListener("blur", () => apertadas.clear());
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.querySelector(".mt-capa")) limpar();
  });

  let execucao = 0; // ignora mensagens de uma tradução antiga
  let tela = null;  // tamanho e rolagem no momento do print
  const baloes = new Map();

  chrome.runtime.onMessage.addListener((m, _remetente, responder) => {
    if (m.tipo === "preparar") {
      preparar(m).then(responder);
      return true;
    }
    if (m.id !== execucao) return;
    if (m.tipo === "aviso") aviso(m.texto, m.erro);
    if (m.tipo === "baloes") desenhar(m.lista, m.fim);
  });

  async function preparar({ acao, id }) {
    execucao = id;
    limpar(); // tradução antiga não pode sair no print novo
    const area = acao === "recortar" ? await selecionarArea() : regiaoDoManga();
    tela = { w: innerWidth, h: innerHeight, sx: scrollX, sy: scrollY };
    // espera a página repintar sem nada nosso por cima antes do print
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    return area;
  }

  function limpar() {
    document.querySelectorAll(".mt-balao, .mt-aviso").forEach((e) => e.remove());
    baloes.clear();
  }

  /** Une as imagens grandes visíveis (as páginas do mangá); sem elas, usa a tela toda. */
  function regiaoDoManga() {
    const W = innerWidth, H = innerHeight;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const el of document.querySelectorAll("img, canvas, video")) {
      const r = el.getBoundingClientRect();
      const l = Math.max(r.left, 0), t = Math.max(r.top, 0), rr = Math.min(r.right, W), b = Math.min(r.bottom, H);
      if (rr - l < 150 || b - t < 150) continue; // ícones, avatares, miniaturas
      x0 = Math.min(x0, l); y0 = Math.min(y0, t); x1 = Math.max(x1, rr); y1 = Math.max(y1, b);
    }
    if (x1 <= x0 || (x1 - x0) * (y1 - y0) < W * H * 0.1) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H };
  }

  /** Deixa o usuário arrastar um retângulo; devolve {x,y,w,h} normalizado na tela, ou null. */
  function selecionarArea() {
    return new Promise((fim) => {
      const capa = document.createElement("div");
      capa.className = "mt-capa";
      capa.innerHTML =
        '<div class="mt-dica">Arraste sobre os balões · <kbd>Esc</kbd> cancela</div>' +
        '<div class="mt-caixa"><span class="mt-medida"></span></div>';
      document.body.appendChild(capa);
      const caixa = capa.querySelector(".mt-caixa");
      const medida = capa.querySelector(".mt-medida");

      let x0, y0;
      const tecla = (e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        terminar(null);
      };
      addEventListener("keydown", tecla, true);
      const terminar = (resultado) => {
        capa.remove();
        removeEventListener("keydown", tecla, true);
        fim(resultado);
      };

      capa.onmousedown = (e) => {
        if (e.button !== 0) return terminar(null);
        x0 = e.clientX; y0 = e.clientY;
        capa.classList.add("mt-arrastando");
        capa.querySelector(".mt-dica")?.remove();
        Object.assign(caixa.style, { display: "block", left: x0 + "px", top: y0 + "px", width: "0", height: "0" });
      };
      capa.onmousemove = (e) => {
        if (x0 === undefined) return;
        const w = Math.abs(e.clientX - x0), h = Math.abs(e.clientY - y0);
        Object.assign(caixa.style, {
          left: Math.min(x0, e.clientX) + "px", top: Math.min(y0, e.clientY) + "px", width: w + "px", height: h + "px",
        });
        medida.textContent = `${Math.round(w)} × ${Math.round(h)}`;
      };
      capa.onmouseup = (e) => {
        if (x0 === undefined) return;
        const w = Math.abs(e.clientX - x0), h = Math.abs(e.clientY - y0);
        if (w < 10 || h < 10) return terminar(null);
        terminar({
          x: Math.min(x0, e.clientX) / innerWidth, y: Math.min(y0, e.clientY) / innerHeight,
          w: w / innerWidth, h: h / innerHeight,
        });
      };
    });
  }

  function aviso(texto, erro) {
    document.querySelector(".mt-aviso")?.remove();
    const d = document.createElement("div");
    d.className = "mt-aviso" + (erro ? " mt-erro" : "");
    d.setAttribute("role", "status");
    if (!erro) d.appendChild(Object.assign(document.createElement("span"), { className: "mt-roda" }));
    d.appendChild(document.createTextNode(texto));
    document.body.appendChild(d);
    if (erro) setTimeout(() => d.remove(), 6000);
  }

  /** Cria/atualiza os balões pela chave; cobre de branco assim que a caixa chega, texto entra depois. */
  function desenhar(lista, fim) {
    const vistos = new Set();
    for (const b of lista) {
      vistos.add(b.chave);
      let el = baloes.get(b.chave);
      if (!el) {
        el = document.createElement("div");
        el.className = "mt-balao mt-vazio";
        el.title = "Clique para fechar";
        el.onclick = () => { el.remove(); baloes.delete(b.chave); };
        Object.assign(el.style, {
          left: b.l * tela.w + tela.sx + "px", top: b.t * tela.h + tela.sy + "px",
          width: (b.r - b.l) * tela.w + "px", height: (b.b - b.t) * tela.h + "px",
        });
        document.body.appendChild(el);
        baloes.set(b.chave, el);
      }
      if (b.texto && el.textContent !== b.texto) {
        el.classList.remove("mt-vazio");
        el.textContent = b.texto;
        ajustarFonte(el);
      }
    }
    if (!fim) return;
    for (const [k, el] of baloes) if (!vistos.has(k) || !el.textContent) { el.remove(); baloes.delete(k); }
    document.querySelector(".mt-aviso")?.remove();
    if (!baloes.size) {
      aviso("Nenhum texto encontrado", true);
      document.querySelector(".mt-aviso")?.classList.remove("mt-erro");
    }
  }

  function ajustarFonte(el) {
    let t = 20;
    el.style.fontSize = t + "px";
    while (t > 9 && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
      el.style.fontSize = --t + "px";
    }
  }
}
