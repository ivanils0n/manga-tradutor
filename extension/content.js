// Roda em toda página: atalhos, pedidos de tradução e os balões traduzidos.
// Tudo fica num shadow DOM fechado, para o CSS do site não bagunçar os balões (e vice-versa).
// Depende de atalhos.js (carregado antes).
if (!window.__mangaTradutor) {
  window.__mangaTradutor = true;
  (() => {
    const site = location.hostname;
    const CHAVES_PREF = ["fonte", "maiusculas", "idioma", "auto", "adiantar", "ingles", "semTeclaUnica"];
    let atalhos = { ...ATALHOS_PADRAO };
    let pref = {
      fonte: "quadrinhos", maiusculas: false, idioma: "pt-BR", auto: {}, adiantar: "todas", ingles: {}, semTeclaUnica: {},
    };
    const toque = matchMedia("(hover: none) and (pointer: coarse)").matches; // celular/tablet: sem mouse
    const ocrLigado = () => !!pref.ingles?.[site]; // site em inglês: o PC lê o texto (Tesseract), a IA só traduz
    let autoPausado = false;
    const autoLigado = () => !!pref.auto?.[site] && !autoPausado;

    async function carregar() {
      atalhos = await lerAtalhos();
      pref = { ...pref, ...(await chrome.storage.local.get(CHAVES_PREF)) };
      aplicarPref();
    }
    carregar().then(() => agendarAuto(600), () => {});
    chrome.storage.onChanged.addListener((c, onde) => {
      if (onde !== "local" || !["atalhos", ...CHAVES_PREF].some((k) => k in c)) return;
      const ligou = c.auto && !c.auto.oldValue?.[site] && c.auto.newValue?.[site];
      if (ligou) autoPausado = false;
      carregar().then(() => ligou && agendarAuto(0), () => {});
    });

    // ---------- camada (shadow DOM) ----------
    let camada = null, raiz = null, oculto = false, reexibir = 0, montando = null;
    const quadro = () => new Promise((ok) => requestAnimationFrame(() => ok()));

    function montar() {
      return (montando ??= (async () => {
        camada = document.createElement("mt-tradutor");
        // presa ao começo da página, não à tela: os balões rolam junto com ela (sem atraso no celular) e não
        // dependem de como cada navegador posiciona "fixed" com a barra de endereço aparecendo e sumindo
        camada.style.cssText = "all:initial;position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;display:block";
        raiz = camada.attachShadow({ mode: "closed" });
        raiz.addEventListener("pointerdown", (e) => { if (menu && !menu.contains(e.target)) fecharMenu(); });
        lugarDaCamada().appendChild(camada);
        aplicarPref();
        await Promise.all([estilizar(), carregarFonte()]);
      })());
    }
    // CSS e fonte lidos pelo próprio script: funciona no Chrome e no Firefox e não esbarra na CSP do site
    const arquivo = (nome) => fetch(chrome.runtime.getURL(nome));
    async function estilizar() {
      try {
        const folha = new CSSStyleSheet();
        folha.replaceSync(await (await arquivo("pagina.css")).text());
        raiz.adoptedStyleSheets = [folha];
        if (raiz.adoptedStyleSheets.length) return;
      } catch { /* navegador sem folha construída: vai pelo <link> */ }
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = chrome.runtime.getURL("pagina.css");
      const carregou = new Promise((ok) => { css.onload = css.onerror = ok; });
      raiz.appendChild(css);
      await carregou;
    }
    async function carregarFonte() {
      try { // no documento (não no shadow DOM): só assim a fonte vale dentro dos balões
        const fonte = new FontFace("MT Quadrinhos", await (await arquivo("fontes/comic-neue-bold.woff")).arrayBuffer(), { weight: "100 900" });
        document.fonts.add(await fonte.load());
        redesenharTudo(); // balões que chegaram antes da fonte
      } catch { /* fica a fonte do sistema */ }
    }
    // em tela cheia só aparece o que está dentro do elemento em tela cheia
    const lugarDaCamada = () => {
      const f = document.fullscreenElement;
      return f && !/^(IMG|VIDEO|CANVAS)$/.test(f.tagName) ? f : document.documentElement;
    };
    document.addEventListener("fullscreenchange", () => camada && lugarDaCamada().appendChild(camada));

    function aplicarPref() {
      if (!camada) return;
      redesenharTudo(); // fonte, maiúsculas
    }
    function mostrarCamada() {
      clearTimeout(reexibir);
      if (camada) camada.style.visibility = "";
    }
    function alternar() { // só os balões (avisos continuam aparecendo)
      if (!camada) return;
      oculto = !oculto;
      camada.toggleAttribute("data-oculto", oculto);
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
        if (comum && pref.semTeclaUnica?.[site]) continue; // desligado neste site (conflita com os atalhos dele)
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
      if (acao === "recortar") recortar();
      else traduzirTela();
    }
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      apertadas.add(nomeTecla(e));
      verificar(e);
    }, true);
    addEventListener("keyup", (e) => apertadas.delete(nomeTecla(e)), true);
    addEventListener("blur", () => { apertadas.clear(); fecharMenu(); });
    addEventListener("pointerdown", (e) => { if (menu && e.target !== camada) fecharMenu(); }, true);
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
    addEventListener("keydown", (e) => { if (e.key === "Escape") fecharMenu(); }, true);
    chrome.runtime.onMessage.addListener((m) => { if (m.tipo === "disparar") disparar(m.acao); });

    // ---------- conversa com o background ----------
    let porta = null, ultimoRid = 0;
    const pedidos = new Map(); // rid → pedido em andamento
    const coberturas = new Map(); // endereço da imagem → { feito: [[y0,y1]], pend: Map(rid → [y0,y1]) }
    const ancoras = new Map(); // endereço da imagem → <img> onde os balões dela ficam
    const falhas = new Set(); // imagens que o background não conseguiu baixar (vão por print)
    let feitoPrint = new WeakMap(); // canvas/imagem sem endereço → faixas já traduzidas por print no modo automático

    function conectar() {
      if (porta) return porta;
      porta = chrome.runtime.connect({ name: "mt" });
      porta.onMessage.addListener(receber);
      porta.onDisconnect.addListener(() => {
        porta = null;
        // o service worker reiniciou: o que estava em andamento se perdeu e pode ser pedido de novo
        const tinhaManual = manual.pendentes > 0;
        for (const rid of [...pedidos.keys()]) concluir(rid, false);
        mostrarCamada();
        if (tinhaManual) aviso("A tradução foi interrompida — tente de novo", "erro");
      });
      return porta;
    }
    function pedir(msg, extra = {}) {
      montar(); // a camada nasce na hora (a parte síncrona), antes de qualquer resposta chegar
      const rid = ++ultimoRid;
      try {
        conectar().postMessage({ ...msg, rid, titulo: document.title }); // o título identifica a obra (glossário automático)
      } catch {
        aviso("A extensão foi atualizada: recarregue a página", "erro");
        return 0;
      }
      pedidos.set(rid, { ...msg, ...extra, rid });
      if (msg.manual) manual.pendentes++;
      atualizarStatus();
      return rid;
    }

    function receber(m) {
      if (m.tipo === "aviso") return aviso(m.msg, "info");
      const p = pedidos.get(m.rid);
      if (!p) return;
      if (m.tipo === "capturado") return mostrarCamada();
      if (m.tipo === "parcial" || m.tipo === "fim") {
        desenhar(p, m.lista, m.tipo === "fim");
        if (m.tipo === "fim") concluir(m.rid, true);
        else if (p.manual && m.total > 1) aviso(`Traduzindo… ${m.prontos}/${m.total}`);
        return;
      }
      if (m.tipo !== "erro") return;
      mostrarCamada();
      concluir(m.rid, false);
      if (m.semImagem && p.tipo === "imagem") {
        // o site não deixa baixar a imagem: traduz a parte visível pelo print
        falhas.add(p.url);
        if (p.recorte) { // recorte: a área marcada, uma vez só (mesmo que várias imagens dela falhem)
          if (!p.recorte.print) p.recorte.print = true, comecarManual(), aviso("Traduzindo…"), pedirPrint(p.recorte, true, undefined, false);
          return;
        }
        const el = ancoras.get(p.url);
        const r = el?.isConnected && el.getBoundingClientRect();
        if (r && r.bottom > 0 && r.top < innerHeight) {
          if (p.manual) comecarManual(), aviso("Traduzindo…");
          const [y0, y1] = faixaNaTela(r);
          pedirPrint(retanguloNaTela(r), p.manual, [{ el, y0, y1 }]);
        }
      } else if (p.manual) {
        aviso(m.msg, "erro");
      } else if (!autoPausado) {
        autoPausado = true; // não insiste num erro a cada rolagem (gastaria tokens)
        aviso("Tradução automática pausada: " + m.msg, "erro");
      }
    }

    function concluir(rid, ok) {
      const p = pedidos.get(rid);
      if (!p) return;
      pedidos.delete(rid);
      if (p.tipo === "imagem") {
        const cob = coberturas.get(p.url);
        cob?.pend.delete(rid);
        if (ok && !p.manual) cob?.feito.push(p.faixa);
      }
      if (ok && p.faixas) for (const f of p.faixas) feitoPrint.set(f.el, [...(feitoPrint.get(f.el) || []), [f.y0, f.y1]]);
      if (p.manual && --manual.pendentes === 0) {
        if (ok && !manual.achou) aviso("Nenhum texto encontrado", "info");
        else fecharAviso();
      }
      atualizarStatus();
    }

    // ---------- o que traduzir ----------
    const manual = { pendentes: 0, achou: false };
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const faixaNaTela = (r) => [clamp(-r.top / r.height), clamp((innerHeight - r.top) / r.height)];
    const retanguloNaTela = (r) => {
      const l = clamp(r.left / innerWidth), t = clamp(r.top / innerHeight);
      return { x: l, y: t, w: clamp(r.right / innerWidth) - l, h: clamp(r.bottom / innerHeight) - t };
    };
    function urlDe(el) {
      if (el.tagName !== "IMG") return "";
      const url = el.currentSrc || el.src;
      return /^(https?|data):/.test(url) && !falhas.has(url) ? url : "";
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
    // no modo automático só entram páginas de mangá, não capas e miniaturas
    const pareceManga = (el, r) => r.width >= 250
      && (r.width >= Math.min(500, innerWidth * 0.4) || r.height >= innerHeight * 0.6)
      && (el.tagName !== "IMG" || (el.naturalWidth >= 300 && el.naturalHeight >= 300));

    function comecarManual() {
      if (!manual.pendentes) manual.achou = false;
    }

    /** Tecla de traduzir: cada imagem visível vai inteira pelo endereço; o resto (canvas etc.) pelo print. */
    async function traduzirTela() {
      await montar();
      comecarManual();
      const midias = listarMidias();
      const semUrl = [];
      for (const { el, r } of midias) {
        const url = urlDe(el);
        if (url) pedirImagem(el, url, faixaNaTela(r), true, 0);
        else semUrl.push({ el, r });
      }
      if (!midias.length) await pedirPrint({ x: 0, y: 0, w: 1, h: 1 }, true);
      else if (semUrl.length) {
        const u = semUrl.map((m) => m.r).reduce((a, r) => ({ left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) }));
        // as faixas ficam marcadas: o modo automático não traduz de novo a mesma parte
        await pedirPrint(retanguloNaTela(u), true, semUrl.map(({ el, r }) => ({ el, y0: faixaNaTela(r)[0], y1: faixaNaTela(r)[1] })));
      }
      if (manual.pendentes) aviso("Traduzindo…");
    }

    /** Recorte vai sempre pela IA com imagem: é o "traduzir com capricho". */
    async function recortar() {
      await montar();
      const area = await selecionarArea();
      if (!area) return;
      comecarManual();
      // marcou só imagens com endereço: a parte marcada sai da imagem original (mais nítida e sem print,
      // que nem todo navegador de celular tira); canvas e o resto vão pelo print
      const sel = { l: area.x * innerWidth, t: area.y * innerHeight, r: (area.x + area.w) * innerWidth, b: (area.y + area.h) * innerHeight };
      const alvos = listarMidias().filter(({ r }) => r.left < sel.r && r.right > sel.l && r.top < sel.b && r.bottom > sel.t);
      let pedidos = 0;
      if (alvos.length && alvos.every(({ el }) => urlDe(el))) {
        for (const { el } of alvos) {
          const d = retanguloDesenho(el), nw = el.naturalWidth, nh = el.naturalHeight, url = urlDe(el);
          const l = Math.max(sel.l, d.left), t = Math.max(sel.t, d.top);
          const r = Math.min(sel.r, d.left + d.width), b = Math.min(sel.b, d.top + d.height);
          if (r - l < 12 || b - t < 12) continue;
          const x = Math.floor(((l - d.left) / d.width) * nw), y = Math.floor(((t - d.top) / d.height) * nh);
          const w = Math.ceil(((r - d.left) / d.width) * nw) - x, h = Math.ceil(((b - d.top) / d.height) * nh) - y;
          if (ancoras.get(url) !== el) coberturas.delete(url);
          ancoras.set(url, el);
          if (pedir({ tipo: "imagem", url, w: nw, h: nh, area: { x, y, w, h }, prioridade: 0, manual: true, ocr: false }, { recorte: area })) pedidos++;
        }
      }
      if (!pedidos) await pedirPrint(area, true, undefined, false);
      if (manual.pendentes) aviso("Traduzindo…");
    }

    function pedirImagem(el, url, faixa, manualmente, prioridade) {
      // outro elemento com a mesma imagem (leitores que recriam as páginas): pede de novo, o cache responde
      if (ancoras.get(url) !== el) coberturas.delete(url);
      const cob = coberturas.get(url) || { feito: [], pend: new Map() };
      coberturas.set(url, cob);
      ancoras.set(url, el);
      if (!manualmente) {
        // no automático, só o que ainda não foi pedido
        const h = el.getBoundingClientRect().height || 1;
        const faltam = subtrair(faixa, [...cob.feito, ...cob.pend.values()]).filter(([a, b]) => (b - a) * h >= 40);
        if (!faltam.length) return 0;
        faixa = [faltam[0][0], faltam.at(-1)[1]];
      }
      const rid = pedir({ tipo: "imagem", url, w: el.naturalWidth, h: el.naturalHeight, faixa, prioridade, manual: manualmente, ocr: ocrLigado() });
      if (rid) cob.pend.set(rid, faixa);
      return rid;
    }

    /** Print de uma área da tela (sem nada nosso por cima na hora do print). */
    async function pedirPrint(area, manualmente, faixas, ocr = ocrLigado()) {
      await montar();
      const midias = listarMidias();
      const tela = { w: innerWidth, h: innerHeight, sx: scrollX, sy: scrollY };
      camada.style.visibility = "hidden";
      clearTimeout(reexibir);
      reexibir = setTimeout(mostrarCamada, 2500);
      await quadro();
      await quadro();
      return pedir({ tipo: "print", area, manual: manualmente, prioridade: manualmente ? 0 : 0.5, ocr }, { midias, tela, faixas });
    }

    function subtrair([a, b], cortes) {
      let partes = [[a, b]];
      for (const [c0, c1] of cortes) {
        partes = partes.flatMap(([p0, p1]) => (c1 <= p0 || c0 >= p1 ? [[p0, p1]] : [[p0, c0], [c1, p1]].filter(([x, y]) => y - x > 0.001)));
      }
      return partes;
    }

    // ---------- modo automático: a tela e as páginas que o site já carregou mais à frente ----------
    let timerAuto = 0;
    function agendarAuto(ms = 450) {
      if (!autoLigado()) return;
      clearTimeout(timerAuto);
      timerAuto = setTimeout(passoAuto, ms);
    }
    function passoAuto() {
      if (!autoLigado() || document.hidden) return;
      const H = innerHeight;
      const telas = { tela: 1, 3: 4, 10: 11 }[pref.adiantar] ?? Infinity;
      const topo = -0.5 * H, fim = H * telas;
      const semUrl = [];
      for (const el of document.querySelectorAll("img, canvas")) {
        const r = el.getBoundingClientRect();
        if (r.bottom < topo || r.top > fim || !pareceManga(el, r)) continue;
        const url = urlDe(el);
        if (url) {
          if (el.complete && el.naturalWidth) {
            const prioridade = Math.max(0, r.top / H);
            pedirImagem(el, url, [clamp((topo - r.top) / r.height), clamp((fim - r.top) / r.height)], false, prioridade);
            if (coberturas.get(url)?.pend.size && porta) porta.postMessage({ tipo: "prioridade", url, prioridade });
          }
        } else if (r.bottom > 0 && r.top < H) semUrl.push({ el, r });
      }
      if (semUrl.length) printAuto(semUrl);
    }
    /** Canvas e imagens que não dá para baixar: print só da parte visível ainda não traduzida. */
    function printAuto(midias) {
      if ([...pedidos.values()].some((p) => p.tipo === "print" && !p.manual)) return agendarAuto(800);
      const H = innerHeight;
      let y0 = H, y1 = 0, x0 = innerWidth, x1 = 0;
      const faixas = [];
      for (const { el, r } of midias) {
        const v0 = clamp(-r.top / r.height), v1 = clamp((H - r.top) / r.height);
        for (const [a, b] of subtrair([v0, v1], feitoPrint.get(el) || [])) {
          if ((b - a) * r.height < 60) continue;
          faixas.push({ el, y0: a, y1: b });
          x0 = Math.min(x0, Math.max(0, r.left)); x1 = Math.max(x1, Math.min(innerWidth, r.right));
          y0 = Math.min(y0, Math.max(0, r.top + a * r.height)); y1 = Math.max(y1, Math.min(H, r.top + b * r.height));
        }
      }
      if (faixas.length) pedirPrint({ x: x0 / innerWidth, y: y0 / H, w: (x1 - x0) / innerWidth, h: (y1 - y0) / H }, false, faixas);
    }
    addEventListener("scroll", () => { agendarPosicao(); agendarAuto(); }, { capture: true, passive: true });
    addEventListener("resize", () => { agendarPosicao(); agendarAuto(); });
    document.addEventListener("load", (e) => { if (e.target.tagName === "IMG") agendarAuto(300); }, true);
    document.addEventListener("visibilitychange", () => agendarAuto(300));
    new MutationObserver(() => agendarAuto(500)).observe(document.documentElement, { childList: true, subtree: true });

    // leitores que trocam de capítulo sem recarregar: balões presos às imagens somem com elas sozinhos
    let endereco = location.href;
    setInterval(() => {
      if (location.href === endereco) return;
      endereco = location.href;
      for (const [k, reg] of baloes) if (!reg.ancora) remover(k);
      agendarAuto(900);
    }, 700);

    // ---------- seleção de área ----------
    function selecionarArea() {
      return new Promise((fim) => {
        const capa = document.createElement("div");
        capa.className = "capa";
        capa.innerHTML =
          `<div class="dica"><b>Recortar</b> arraste sobre os balões · ${toque ? "um toque cancela" : "<kbd>Esc</kbd> cancela"}</div>` +
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
        // eventos de ponteiro: o mesmo código vale para mouse, dedo e caneta
        capa.onpointerdown = (e) => {
          if (e.button !== 0) return terminar(null);
          e.preventDefault();
          capa.setPointerCapture(e.pointerId);
          x0 = e.clientX; y0 = e.clientY;
          capa.classList.add("arrastando");
          Object.assign(selecao.style, { display: "block", left: x0 + "px", top: y0 + "px", width: "0", height: "0" });
        };
        capa.onpointermove = (e) => {
          if (x0 === undefined) return;
          const w = Math.abs(e.clientX - x0), h = Math.abs(e.clientY - y0);
          Object.assign(selecao.style, {
            left: Math.min(x0, e.clientX) + "px", top: Math.min(y0, e.clientY) + "px", width: w + "px", height: h + "px",
          });
          medida.textContent = `${Math.round(w)} × ${Math.round(h)}`;
        };
        capa.onpointercancel = () => terminar(null);
        capa.onpointerup = (e) => {
          if (x0 === undefined) return;
          const w = Math.abs(e.clientX - x0), h = Math.abs(e.clientY - y0);
          if (w < 12 || h < 12) return terminar(null);
          terminar({ x: Math.min(x0, e.clientX) / innerWidth, y: Math.min(y0, e.clientY) / innerHeight, w: w / innerWidth, h: h / innerHeight });
        };
      });
    }

    // ---------- avisos ----------
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
      if (tipo) timerAviso = setTimeout(() => d.remove(), tipo === "erro" ? 6000 : texto.length > 40 ? 4500 : 2200);
    }
    const fecharAviso = () => raiz?.querySelector(".aviso:not(.erro)")?.remove();

    /** Selo discreto no canto enquanto o modo automático traduz adiante. */
    function atualizarStatus() {
      if (!raiz) return;
      const n = [...pedidos.values()].filter((p) => !p.manual).length;
      let s = raiz.querySelector(".fila");
      if (!n) return s?.remove();
      if (!s) {
        s = document.createElement("div");
        s.className = "fila";
        s.setAttribute("role", "status");
        raiz.appendChild(s);
      }
      s.innerHTML = '<span class="roda"></span>';
      s.append(`Traduzindo adiante · ${n}`);
    }

    // ---------- balões ----------
    const baloes = new Map(); // chave → registro
    const removidos = new Set(); // removidos pelo usuário: o automático não traz de volta
    const uniao = (a, b) => ({ l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) });

    function desenhar(p, lista, fim) {
      const vistos = new Set();
      for (const b of lista) {
        vistos.add(b.chave);
        if (removidos.has(b.chave)) {
          if (!p.manual) continue;
          removidos.delete(b.chave); // pedido de novo na mão: volta
        }
        let reg = baloes.get(b.chave);
        if (!reg && !(reg = criarBalao(b, p))) continue;
        reg.rid = p.rid;
        geometria(reg, b, p);
        if (b.remendo && b.remendo !== reg.remendoUrl) desenharRemendo(reg, b.remendo);
        if (b.texto && b.texto !== reg.texto) {
          reg.texto = b.texto;
          reg.txt.textContent = b.texto;
          reg.el.classList.remove("vazio");
          reg.ajustar = true;
        }
        if (b.texto && p.manual) manual.achou = true;
      }
      if (fim) for (const [k, reg] of baloes) if (reg.rid === p.rid && (!vistos.has(k) || !reg.texto)) remover(k);
      posicionar();
      contar();
    }

    function criarBalao(b, p) {
      let ancora = null, A0 = null;
      if (p.tipo === "imagem") {
        ancora = ancoras.get(p.url);
        if (!ancora?.isConnected) return null;
      } else {
        // print: âncora na imagem que estava embaixo, para acompanhar rolagem (inclusive interna) e zoom
        const { w: W, h: H } = p.tela;
        const cx = ((b.cobre.l + b.cobre.r) / 2) * W, cy = ((b.cobre.t + b.cobre.b) / 2) * H;
        const midia = p.midias.find(({ r }) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom);
        ancora = midia?.el || null;
        A0 = midia ? midia.r : { left: 0, top: 0, width: W, height: H };
      }
      const el = document.createElement("div");
      el.className = "balao vazio";
      const tela = document.createElement("canvas"); // o balão traduzido é pintado aqui (ver desenho.js)
      tela.className = "pintura";
      const cobre = document.createElement("div"); // retícula andando enquanto a tradução não chega
      cobre.className = "cobre";
      const txt = document.createElement("div"); // o texto em si, invisível: para leitores de tela
      txt.className = "txt";
      txt.lang = pref.idioma || "pt-BR";
      el.append(tela, cobre, txt);
      el.title = toque ? "" : "Clique: ver o original · botão direito: mais opções";
      const k = b.chave;
      let segurou = 0, timer = 0, ini = null;
      const menuBalao = (x, y) => {
        clearTimeout(timer);
        segurou = Date.now();
        abrirMenu({ x, y }, [
          [el.classList.contains("original") ? "Ver tradução" : "Ver original", () => el.classList.toggle("original")],
          ["Remover este balão", () => { removidos.add(k); remover(k); }],
          ...(baloes.size > 1 ? [[`Remover todos (${baloes.size})`, () => { for (const c of [...baloes.keys()]) { removidos.add(c); remover(c); } }]] : []),
        ]);
      };
      el.addEventListener("click", () => { if (Date.now() - segurou > 1500) el.classList.toggle("original"); });
      el.addEventListener("contextmenu", (e) => { // botão direito (ou o toque longo do navegador)
        e.preventDefault();
        e.stopPropagation();
        if (Date.now() - segurou > 1500) menuBalao(e.clientX, e.clientY);
      });
      // celular: segurar o dedo abre o menu sem depender do navegador; rolar a página por cima cancela
      el.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch") return;
        ini = [e.clientX, e.clientY];
        timer = setTimeout(() => { navigator.vibrate?.(12); menuBalao(...ini); }, 500);
      });
      el.addEventListener("pointermove", (e) => { if (ini && Math.hypot(e.clientX - ini[0], e.clientY - ini[1]) > 10) clearTimeout(timer); });
      for (const t of ["pointerup", "pointercancel"]) el.addEventListener(t, () => clearTimeout(timer));
      raiz.appendChild(el);
      const reg = {
        el, tela, cobre, txt, texto: "", ajustar: false, w: 0, h: 0, ancora, A0, sx: p.tela?.sx, sy: p.tela?.sy, geo: "",
        url: p.url, conteudo: p.tipo === "imagem", // pedido pela imagem: coordenadas no desenho da imagem
      };
      baloes.set(b.chave, reg);
      geometria(reg, b, p);
      substituirSobrepostos(b.chave, reg);
      return reg;
    }

    /** Posição relativa à âncora e à parte que cobre o texto original. Muda quando partes do mesmo balão se juntam. */
    function geometria(reg, b, p) {
      const geo = JSON.stringify([b.area, b.alta, b.cobre, b.perfil]);
      if (geo === reg.geo) return;
      reg.geo = geo;
      // a caixa do balão: o texto original, os espaços livres e o formato do balão (onde a tradução pode ir)
      const pf = b.perfil, larga = pf ? Math.max(...pf.meia) : 0;
      let u = uniao(uniao(b.area, b.alta || b.area), b.cobre);
      if (pf) u = uniao(u, { l: pf.cx - larga, t: pf.t, r: pf.cx + larga, b: pf.b });
      if (p.tipo === "imagem") reg.rel = u; // já vem normalizado na imagem
      else {
        const { w: W, h: H } = p.tela, A0 = reg.A0;
        reg.rel = {
          l: (u.l * W - A0.left) / A0.width, t: (u.t * H - A0.top) / A0.height,
          r: (u.r * W - A0.left) / A0.width, b: (u.b * H - A0.top) / A0.height,
        };
      }
      const w = u.r - u.l, h = u.b - u.t;
      const rel = (q) => ({ l: (q.l - u.l) / w, t: (q.t - u.t) / h, r: (q.r - u.l) / w, b: (q.b - u.t) / h });
      reg.cob = rel(b.cobre); // onde estava o texto original, em fração da caixa do balão
      reg.areas = [rel(b.area), ...(b.alta ? [rel(b.alta)] : [])]; // onde a tradução pode ir (largo e alto)
      reg.perfil = pf && { cx: (pf.cx - u.l) / w, t: (pf.t - u.t) / h, b: (pf.b - u.t) / h, meia: pf.meia.map((m) => m / w) };
      reg.letra = b.letra ? b.letra / h : 0; // tamanho da letra original, em fração da altura da caixa
      Object.assign(reg.cobre.style, {
        left: reg.cob.l * 100 + "%", top: reg.cob.t * 100 + "%",
        width: (reg.cob.r - reg.cob.l) * 100 + "%", height: (reg.cob.b - reg.cob.t) * 100 + "%",
      });
      Object.assign(reg, { fundo: b.fundo, claro: b.claro, uniforme: b.uniforme });
      reg.w = reg.h = 0; // força reposicionar e repintar
    }

    /** Traduzir de novo o mesmo lugar (outro recorte, outro modo) troca o balão antigo em vez de empilhar. */
    function substituirSobrepostos(chave, reg) {
      const novo = retangulo(reg);
      if (!novo) return;
      for (const [k, outro] of baloes) {
        if (k === chave) continue;
        const r = retangulo(outro);
        if (!r) continue;
        const w = Math.min(novo.r, r.r) - Math.max(novo.l, r.l), h = Math.min(novo.b, r.b) - Math.max(novo.t, r.t);
        const menor = Math.min((novo.r - novo.l) * (novo.b - novo.t), (r.r - r.l) * (r.b - r.t));
        if (w > 0 && h > 0 && (w * h) / menor > 0.5) remover(k);
      }
    }

    function retanguloAncora(reg) {
      if (reg.ancora) {
        if (!reg.ancora.isConnected) return null;
        return reg.conteudo ? retanguloDesenho(reg.ancora) : reg.ancora.getBoundingClientRect();
      }
      return { left: reg.A0.left + reg.sx - scrollX, top: reg.A0.top + reg.sy - scrollY, width: reg.A0.width, height: reg.A0.height };
    }
    /**
     * Onde a imagem está desenhada dentro do <img>: com object-fit (leitores de página única que
     * encaixam a página na tela) o desenho é menor que a caixa do elemento.
     */
    function retanguloDesenho(img) {
      const r = img.getBoundingClientRect();
      const cs = getComputedStyle(img);
      const n = (v) => parseFloat(v) || 0;
      const l = r.left + n(cs.borderLeftWidth) + n(cs.paddingLeft), t = r.top + n(cs.borderTopWidth) + n(cs.paddingTop);
      const w = r.right - n(cs.borderRightWidth) - n(cs.paddingRight) - l, h = r.bottom - n(cs.borderBottomWidth) - n(cs.paddingBottom) - t;
      const nw = img.naturalWidth, nh = img.naturalHeight, ajuste = cs.objectFit;
      if (!nw || !nh || !w || !h || ajuste === "fill" || !ajuste) return { left: l, top: t, width: w, height: h };
      let s = ajuste === "cover" ? Math.max(w / nw, h / nh) : Math.min(w / nw, h / nh);
      if (ajuste === "none") s = 1;
      if (ajuste === "scale-down") s = Math.min(1, s);
      // shortcut: object-position só em porcentagem/palavras (o padrão é centro); em px fica centralizado
      const [px, py] = (cs.objectPosition || "50% 50%").split(" ").map((v) => (/%$/.test(v) ? parseFloat(v) / 100 : 0.5));
      return { left: l + (w - nw * s) * px, top: t + (h - nh * s) * py, width: nw * s, height: nh * s };
    }

    function retangulo(reg, r = retanguloAncora(reg)) {
      if (!r || !r.width) return null;
      return {
        l: r.left + reg.rel.l * r.width, t: r.top + reg.rel.t * r.height,
        r: r.left + reg.rel.r * r.width, b: r.top + reg.rel.b * r.height,
      };
    }

    /**
     * Fundo reconstruído atrás de texto escrito sobre o desenho. Decodificado aqui e pintado no canvas
     * do balão, não como imagem: a política de segurança de alguns sites bloqueia imagens "data:".
     */
    async function desenharRemendo(reg, url) {
      reg.remendoUrl = url;
      try {
        const bytes = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));
        reg.remendo = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        reg.ajustar = true;
        redesenharTudo();
      } catch { /* fica a cor lisa */ }
    }

    function remover(k) {
      baloes.get(k)?.el.remove();
      baloes.delete(k);
      contar();
    }
    // para diagnóstico e testes: quantos balões com tradução estão na página
    const contar = () => camada?.setAttribute("data-baloes", [...baloes.values()].filter((r) => r.texto).length);

    function posicionar() {
      if (!camada) return;
      const W = innerWidth, H = innerHeight;
      const origem = camada.getBoundingClientRect(); // onde está o começo da camada (rola com a página)
      const rects = new Map(); // a mesma imagem tem vários balões: mede uma vez só
      for (const [k, reg] of baloes) {
        const chaveRect = reg.ancora && (reg.conteudo ? "c" : "b");
        let r = reg.ancora ? rects.get(reg.ancora)?.[chaveRect] : null;
        if (!r) {
          r = retanguloAncora(reg);
          if (!r) {
            if (reg.url) coberturas.delete(reg.url); // a imagem saiu da página; se voltar, é pedida de novo
            remover(k);
            continue;
          }
          if (reg.ancora) rects.set(reg.ancora, { ...rects.get(reg.ancora), [chaveRect]: r });
        }
        const c = retangulo(reg, r);
        // fora da tela (com folga de uma tela, para não "pipocar" ao rolar rápido): nem desenha
        const fora = !c || c.t > 2 * H || c.b < -H || c.l > W || c.r < 0;
        reg.el.style.display = fora ? "none" : "";
        if (fora) continue;
        const w = c.r - c.l, h = c.b - c.t;
        reg.el.style.transform = `translate(${c.l - origem.left}px,${c.t - origem.top}px)`;
        if (Math.abs(w - reg.w) > 0.5 || Math.abs(h - reg.h) > 0.5) {
          reg.el.style.width = w + "px";
          reg.el.style.height = h + "px";
          reg.w = w; reg.h = h; reg.ajustar = true;
        }
        if (Math.abs(c.l - (reg.x ?? c.l)) > 1) reg.ajustar = true; // andou para o lado: a tradução tem de seguir dentro da tela
        if (reg.ajustar) {
          reg.ajustar = false;
          reg.x = c.l;
          pintar(reg);
        }
      }
    }

    // letra mínima: no celular a tela é pequena e o canvas sai nítido mesmo com letra menor
    const MINIMO = toque ? 11 : 13;
    const emPx = (q, reg) => ({ l: q.l * reg.w, t: q.t * reg.h, r: q.r * reg.w, b: q.b * reg.h });
    function pintar(reg) {
      pintarBalao(reg.tela, {
        w: reg.w, h: reg.h, fundo: reg.fundo, claro: reg.claro, uniforme: reg.uniforme, remendo: reg.remendo, texto: reg.texto,
        cobre: emPx(reg.cob, reg), areas: reg.areas.map((a) => emPx(a, reg)), letra: reg.letra * reg.h,
        perfil: reg.perfil && { cx: reg.perfil.cx * reg.w, t: reg.perfil.t * reg.h, b: reg.perfil.b * reg.h, meia: reg.perfil.meia.map((m) => m * reg.w) },
        fonte: pref.fonte, maiusculas: !!pref.maiusculas, idioma: pref.idioma || "pt-BR", minimo: MINIMO,
        x: reg.x, largTela: document.documentElement.clientWidth || innerWidth, escala: Math.min(3, (devicePixelRatio || 1) * (visualViewport?.scale || 1)),
      });
    }

    let pedidoQuadro = 0;
    const quadroPosicao = () => {
      if (baloes.size && !pedidoQuadro) pedidoQuadro = requestAnimationFrame(() => { pedidoQuadro = 0; posicionar(); });
    };
    const agendarPosicao = () => { fecharMenu(); quadroPosicao(); };
    /** Pinta tudo de novo (fonte carregou, preferência mudou, zoom): sem fechar o menu aberto. */
    function redesenharTudo() {
      for (const reg of baloes.values()) reg.ajustar = true;
      quadroPosicao();
    }
    // zoom com dois dedos: pinta de novo na resolução nova (senão a letra fica borrada)
    let timerZoom = 0;
    visualViewport?.addEventListener("resize", () => { clearTimeout(timerZoom); timerZoom = setTimeout(redesenharTudo, 200); });

    // ---------- menu do balão (botão direito, ou segurar o dedo) ----------
    let menu = null;
    /** onde: o ponto do clique ({x, y}). itens: [[texto, ação]]. */
    function abrirMenu(onde, itens) {
      fecharMenu();
      menu = document.createElement("div");
      menu.className = "menu";
      menu.setAttribute("role", "menu");
      for (const [texto, f] of itens) {
        const b = document.createElement("button");
        b.setAttribute("role", "menuitem");
        b.textContent = texto;
        b.onclick = (e) => { e.stopPropagation(); f(); fecharMenu(); };
        menu.appendChild(b);
      }
      raiz.appendChild(menu);
      const r = menu.getBoundingClientRect();
      const { x, y } = onde;
      menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
      menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
      menu.querySelector("button").focus();
      // teclado: setas andam entre as opções, Enter escolhe, Esc fecha
      menu.addEventListener("keydown", (e) => {
        const bs = [...menu.querySelectorAll("button")];
        const i = bs.indexOf(raiz.activeElement);
        const ir = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: bs.length - 1 }[e.key];
        if (ir === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        bs[(ir + bs.length) % bs.length].focus();
      });
    }
    function fecharMenu() {
      menu?.remove();
      menu = null;
    }
  })();
}
