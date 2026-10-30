// Roda em toda página: atalhos, seleção de área, avisos e os balões traduzidos.
// Tudo fica num shadow DOM fechado, para o CSS do site não bagunçar os balões (e vice-versa).
// Depende de atalhos.js (carregado antes).
if (!window.__mangaTradutor) {
  window.__mangaTradutor = true;
  (() => {
    const site = location.hostname;
    let atalhos = { ...ATALHOS_PADRAO };
    let pref = { fonte: "quadrinhos", maiusculas: false, idioma: "pt-BR", auto: {} };
    let autoPausado = false;
    const autoLigado = () => !!pref.auto?.[site] && !autoPausado;

    async function carregar() {
      atalhos = await lerAtalhos();
      pref = { ...pref, ...(await chrome.storage.local.get(["fonte", "maiusculas", "idioma", "auto"])) };
      aplicarPref();
    }
    carregar().then(() => autoLigado() && setTimeout(pedirAuto, 800));
    chrome.storage.onChanged.addListener((c, onde) => {
      if (onde !== "local") return;
      const ligou = c.auto && !c.auto.oldValue?.[site] && c.auto.newValue?.[site];
      if (ligou) autoPausado = false;
      carregar().then(() => ligou && pedirAuto());
    });

    // ---------- camada (shadow DOM) ----------
    let camada = null, raiz = null, oculto = false, reexibir = 0;
    const quadro = () => new Promise((ok) => requestAnimationFrame(() => ok()));

    async function montar() {
      if (camada) return;
      camada = document.createElement("mt-tradutor");
      camada.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:block";
      raiz = camada.attachShadow({ mode: "closed" });
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = chrome.runtime.getURL("pagina.css");
      const carregou = new Promise((ok) => { css.onload = css.onerror = ok; });
      raiz.appendChild(css);
      (lugarDaCamada()).appendChild(camada);
      aplicarPref();
      await carregou;
    }
    // em tela cheia só aparece o que está dentro do elemento em tela cheia
    const lugarDaCamada = () => {
      const f = document.fullscreenElement;
      return f && !/^(IMG|VIDEO|CANVAS)$/.test(f.tagName) ? f : document.documentElement;
    };
    document.addEventListener("fullscreenchange", () => camada && lugarDaCamada().appendChild(camada));

    function aplicarPref() {
      if (!camada) return;
      camada.setAttribute("data-fonte", pref.fonte);
      camada.toggleAttribute("data-maiusculas", !!pref.maiusculas);
    }
    function mostrarCamada() {
      clearTimeout(reexibir);
      if (camada) camada.style.visibility = "";
    }
    function alternar() {
      if (!camada) return;
      oculto = !oculto;
      camada.style.display = oculto ? "none" : "block";
    }

    // ---------- atalhos (teclado e mouse) ----------
    const editavel = (el) => el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || "");
    const apertadas = new Set();
    let engolirMouse = 0;

    function verificar(e) {
      for (const [acao, combo] of Object.entries(atalhos)) {
        if (!combo?.length || !mesmoCombo(combo, [...apertadas])) continue;
        // tecla comum (sem Ctrl/Alt/Meta) não dispara enquanto o usuário digita
        const comum = combo.every((t) => !["Ctrl", "Alt", "Meta"].includes(t) && !Object.values(BOTOES_MOUSE).includes(t));
        if (comum && editavel(e.composedPath?.()[0] || e.target)) return false;
        e.preventDefault();
        e.stopImmediatePropagation();
        for (const t of combo) if (!MODIFICADORES.includes(t)) apertadas.delete(t);
        disparar(acao);
        return true;
      }
      return false;
    }
    function disparar(acao) {
      if (acao === "alternar") return alternar();
      autoPausado = false;
      chrome.runtime.sendMessage({ acao }).catch(() => {});
    }
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      apertadas.add(nomeTecla(e));
      verificar(e);
    }, true);
    addEventListener("keyup", (e) => apertadas.delete(nomeTecla(e)), true);
    addEventListener("blur", () => apertadas.clear());
    addEventListener("mousedown", (e) => {
      const b = BOTOES_MOUSE[e.button];
      if (!b) return;
      apertadas.add(b);
      if (verificar(e)) engolirMouse = Date.now();
      apertadas.delete(b);
    }, true);
    // o botão "voltar" do mouse navega no mouseup: bloqueia também
    for (const tipo of ["mouseup", "auxclick"]) {
      addEventListener(tipo, (e) => {
        if (BOTOES_MOUSE[e.button] && Date.now() - engolirMouse < 1500) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }, true);
    }
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !raiz?.querySelector(".capa") && baloes.size) limpar();
    });

    // ---------- comunicação com o background ----------
    let ids = new Set();
    const capturas = new Map(); // id → estado no momento do print
    let feito = new WeakMap(); // imagem → faixas [y0,y1] (frações) já traduzidas no modo automático
    const baloes = new Map();

    chrome.runtime.onMessage.addListener((m, _remetente, responder) => {
      if (m.tipo === "preparar") {
        preparar(m).then(responder, () => responder(null));
        return true;
      }
      if (m.tipo === "alternar") return void alternar();
      if (!ids.has(m.id)) return;
      if (m.tipo === "capturado") mostrarCamada();
      else if (m.tipo === "baloes") desenhar(m);
      else if (m.tipo === "aviso") {
        mostrarCamada();
        const cap = capturas.get(m.id);
        if (cap?.auto) {
          autoPausado = true; // não insiste num erro a cada rolagem (gastaria tokens)
          aviso("Tradução automática pausada: " + m.texto, "erro");
        } else aviso(m.texto, "erro");
        encerrar(m.id);
      }
    });

    async function preparar({ acao, id, auto }) {
      if (auto && (!autoLigado() || document.hidden)) return null;
      await montar();
      if (!auto) {
        limpar();
        ids = new Set();
        feito = new WeakMap();
        if (oculto) alternar();
      }
      const midias = listarMidias();
      let area, faixas = [];
      if (acao === "recortar") area = await selecionarArea();
      else if (auto) [area, faixas] = regiaoNova(midias);
      else area = regiaoDoManga(midias);
      if (!area) return null;
      ids.add(id);
      capturas.set(id, { auto, midias, faixas, tela: { w: innerWidth, h: innerHeight, sx: scrollX, sy: scrollY } });
      camada.style.visibility = "hidden"; // nada nosso no print
      reexibir = setTimeout(mostrarCamada, 2500);
      await quadro();
      await quadro();
      return area;
    }

    function encerrar(id) {
      ids.delete(id);
      capturas.delete(id);
    }

    function listarMidias() {
      const W = innerWidth, H = innerHeight;
      return [...document.querySelectorAll("img, canvas, video")].flatMap((el) => {
        const r = el.getBoundingClientRect();
        const visivel = r.width >= 150 && r.height >= 150 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W;
        const pronta = el.tagName !== "IMG" || (el.complete && el.naturalWidth > 0);
        return visivel && pronta ? [{ el, r }] : [];
      });
    }

    /** Une as imagens grandes visíveis (as páginas do mangá); sem elas, usa a tela toda. */
    function regiaoDoManga(midias) {
      const W = innerWidth, H = innerHeight;
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      for (const { r } of midias) {
        x0 = Math.min(x0, Math.max(r.left, 0)); y0 = Math.min(y0, Math.max(r.top, 0));
        x1 = Math.max(x1, Math.min(r.right, W)); y1 = Math.max(y1, Math.min(r.bottom, H));
      }
      if (x1 <= x0 || (x1 - x0) * (y1 - y0) < W * H * 0.1) return { x: 0, y: 0, w: 1, h: 1 };
      return { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H };
    }

    /** Modo automático: só a parte das imagens que ainda não foi traduzida (nem está sendo). */
    function regiaoNova(midias) {
      const W = innerWidth, H = innerHeight;
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      const faixas = [];
      for (const { el, r } of midias) {
        const v0 = Math.max(0, -r.top / r.height), v1 = Math.min(1, (H - r.top) / r.height);
        const cobertas = [...(feito.get(el) || []), ...[...capturas.values()].flatMap((c) => c.faixas.filter((f) => f.el === el))
          .map((f) => [f.y0, f.y1])];
        for (const [a, b] of subtrair([v0, v1], cobertas)) {
          if ((b - a) * r.height < 60) continue;
          faixas.push({ el, y0: a, y1: b });
          x0 = Math.min(x0, Math.max(r.left, 0)); x1 = Math.max(x1, Math.min(r.right, W));
          y0 = Math.min(y0, r.top + a * r.height); y1 = Math.max(y1, r.top + b * r.height);
        }
      }
      if (!faixas.length) return [null, []];
      return [{ x: x0 / W, y: Math.max(0, y0) / H, w: (x1 - x0) / W, h: (Math.min(H, y1) - Math.max(0, y0)) / H }, faixas];
    }

    function subtrair([a, b], cortes) {
      let partes = [[a, b]];
      for (const [c0, c1] of cortes) {
        partes = partes.flatMap(([p0, p1]) => (c1 <= p0 || c0 >= p1 ? [[p0, p1]] : [[p0, c0], [c1, p1]].filter(([x, y]) => y - x > 0.001)));
      }
      return partes;
    }

    // ---------- seleção de área ----------
    function selecionarArea() {
      return new Promise((fim) => {
        const capa = document.createElement("div");
        capa.className = "capa";
        capa.innerHTML =
          '<div class="dica"><b>Recortar</b> arraste sobre os balões · <kbd>Esc</kbd> cancela</div>' +
          '<div class="selecao"><span class="medida"></span></div>';
        raiz.appendChild(capa);
        const selecao = capa.querySelector(".selecao");
        const medida = capa.querySelector(".medida");
        let x0, y0;
        const tecla = (e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopImmediatePropagation();
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
          e.preventDefault();
          x0 = e.clientX; y0 = e.clientY;
          capa.classList.add("arrastando");
          Object.assign(selecao.style, { display: "block", left: x0 + "px", top: y0 + "px", width: "0", height: "0" });
        };
        capa.onmousemove = (e) => {
          if (x0 === undefined) return;
          const w = Math.abs(e.clientX - x0), h = Math.abs(e.clientY - y0);
          Object.assign(selecao.style, {
            left: Math.min(x0, e.clientX) + "px", top: Math.min(y0, e.clientY) + "px", width: w + "px", height: h + "px",
          });
          medida.textContent = `${Math.round(w)} × ${Math.round(h)}`;
        };
        capa.onmouseup = (e) => {
          if (x0 === undefined) return;
          const w = Math.abs(e.clientX - x0), h = Math.abs(e.clientY - y0);
          if (w < 12 || h < 12) return terminar(null);
          terminar({ x: Math.min(x0, e.clientX) / innerWidth, y: Math.min(y0, e.clientY) / innerHeight, w: w / innerWidth, h: h / innerHeight });
        };
      });
    }

    // ---------- aviso ----------
    let timerAviso = 0;
    function aviso(texto, tipo = "") {
      if (!raiz) return;
      clearTimeout(timerAviso);
      let d = raiz.querySelector(".aviso");
      if (!d) {
        d = document.createElement("div");
        d.setAttribute("role", "status");
        raiz.appendChild(d);
      }
      d.className = "aviso " + tipo;
      d.replaceChildren();
      if (!tipo) d.appendChild(Object.assign(document.createElement("span"), { className: "roda" }));
      d.appendChild(document.createTextNode(texto));
      if (tipo) timerAviso = setTimeout(() => d.remove(), tipo === "erro" ? 6000 : 2200);
    }
    const fecharAviso = () => raiz?.querySelector(".aviso:not(.erro)")?.remove();

    // ---------- balões ----------
    function desenhar(m) {
      const cap = capturas.get(m.id);
      if (!cap) return;
      if (!m.fim) aviso(m.total > 1 ? `Traduzindo… ${m.prontos}/${m.total}` : "Traduzindo…");
      for (const b of m.lista) {
        const reg = baloes.get(b.chave) || criarBalao(b, cap);
        if (b.texto && b.texto !== reg.texto) {
          reg.texto = b.texto;
          reg.txt.textContent = b.texto;
          reg.el.classList.remove("vazio");
          reg.ajustar = true;
        }
      }
      posicionar();
      if (!m.fim) return;
      const vistos = new Set(m.lista.map((b) => b.chave));
      for (const [k, reg] of baloes) if (k.startsWith(m.id + ":") && (!vistos.has(k) || !reg.texto)) remover(k);
      if (cap.auto) {
        for (const f of cap.faixas) feito.set(f.el, [...(feito.get(f.el) || []), [f.y0, f.y1]]);
        fecharAviso();
      } else if (!m.lista.some((b) => b.texto)) aviso("Nenhum texto encontrado", "info");
      else fecharAviso();
      encerrar(m.id);
    }

    function criarBalao(b, cap) {
      const { w: W, h: H } = cap.tela;
      const a = {
        l: Math.min(b.area.l, b.cobre.l) * W, t: Math.min(b.area.t, b.cobre.t) * H,
        r: Math.max(b.area.r, b.cobre.r) * W, b: Math.max(b.area.b, b.cobre.b) * H,
      };
      const cx = ((b.cobre.l + b.cobre.r) / 2) * W, cy = ((b.cobre.t + b.cobre.b) / 2) * H;
      // ancora na imagem embaixo: o balão acompanha rolagem (até dentro de leitores com scroll próprio) e zoom
      const midia = cap.midias.find(({ r }) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom);
      const A0 = midia ? midia.r : { left: 0, top: 0, width: W, height: H };
      const el = document.createElement("div");
      el.className = "balao vazio" + (b.uniforme ? "" : " sobre-arte") + (b.claro ? "" : " escuro");
      el.style.setProperty("--fundo", b.fundo);
      const cobre = document.createElement("div");
      cobre.className = "cobre";
      const pw = a.r - a.l, ph = a.b - a.t;
      Object.assign(cobre.style, {
        left: ((b.cobre.l * W - a.l) / pw) * 100 + "%", top: ((b.cobre.t * H - a.t) / ph) * 100 + "%",
        width: (((b.cobre.r - b.cobre.l) * W) / pw) * 100 + "%", height: (((b.cobre.b - b.cobre.t) * H) / ph) * 100 + "%",
      });
      const txt = document.createElement("div");
      txt.className = "txt";
      txt.lang = pref.idioma || "pt-BR";
      el.append(cobre, txt);
      el.title = "Clique para ver o original";
      el.addEventListener("click", () => el.classList.toggle("original"));
      raiz.appendChild(el);
      const reg = {
        el, txt, texto: "", ajustar: false, w: 0, h: 0, ancora: midia?.el, A0, sx: cap.tela.sx, sy: cap.tela.sy,
        rel: { l: (a.l - A0.left) / A0.width, t: (a.t - A0.top) / A0.height, r: (a.r - A0.left) / A0.width, b: (a.b - A0.top) / A0.height },
      };
      baloes.set(b.chave, reg);
      return reg;
    }

    function remover(k) {
      baloes.get(k)?.el.remove();
      baloes.delete(k);
    }

    function limpar() {
      for (const k of [...baloes.keys()]) remover(k);
      fecharAviso();
    }

    function posicionar() {
      const W = innerWidth, H = innerHeight;
      for (const [k, reg] of baloes) {
        let r;
        if (reg.ancora) {
          if (!reg.ancora.isConnected) { remover(k); continue; }
          r = reg.ancora.getBoundingClientRect();
        } else {
          r = { left: reg.A0.left + reg.sx - scrollX, top: reg.A0.top + reg.sy - scrollY, width: reg.A0.width, height: reg.A0.height };
        }
        const l = r.left + reg.rel.l * r.width, t = r.top + reg.rel.t * r.height;
        const w = (reg.rel.r - reg.rel.l) * r.width, h = (reg.rel.b - reg.rel.t) * r.height;
        const fora = !r.width || t > H || t + h < 0 || l > W || l + w < 0;
        reg.el.style.display = fora ? "none" : "";
        if (fora) continue;
        reg.el.style.transform = `translate(${l}px,${t}px)`;
        if (Math.abs(w - reg.w) > 0.5 || Math.abs(h - reg.h) > 0.5) {
          reg.el.style.width = w + "px";
          reg.el.style.height = h + "px";
          reg.w = w; reg.h = h; reg.ajustar = true;
        }
        if (reg.ajustar && reg.texto) {
          reg.ajustar = false;
          ajustarFonte(reg);
        }
      }
    }

    /** Maior fonte que cabe no balão (busca binária). */
    function ajustarFonte(reg) {
      const t = reg.txt;
      const cabe = () => t.scrollHeight <= t.clientHeight + 1 && t.scrollWidth <= t.clientWidth + 1;
      let lo = 7, hi = Math.max(10, Math.min(30, reg.h * 0.42));
      t.style.fontSize = hi + "px";
      if (cabe()) return;
      while (hi - lo > 0.5) {
        const meio = (lo + hi) / 2;
        t.style.fontSize = meio + "px";
        if (cabe()) lo = meio; else hi = meio;
      }
      t.style.fontSize = lo + "px";
    }

    let pedidoQuadro = 0;
    const agendarPosicao = () => { if (baloes.size && !pedidoQuadro) pedidoQuadro = requestAnimationFrame(() => { pedidoQuadro = 0; posicionar(); }); };

    // ---------- modo automático ----------
    let timerAuto = 0;
    function pedirAuto() {
      if (autoLigado() && !document.hidden) chrome.runtime.sendMessage({ acao: "pagina", auto: true }).catch(() => {});
    }
    addEventListener("scroll", () => {
      agendarPosicao();
      if (!autoLigado()) return;
      clearTimeout(timerAuto);
      timerAuto = setTimeout(pedirAuto, 450);
    }, { capture: true, passive: true });
    addEventListener("resize", agendarPosicao);

    // leitores que trocam de capítulo sem recarregar a página
    let endereco = location.href;
    setInterval(() => {
      if (location.href === endereco) return;
      endereco = location.href;
      limpar();
      feito = new WeakMap();
      if (autoLigado()) setTimeout(pedirAuto, 900);
    }, 700);
  })();
}
