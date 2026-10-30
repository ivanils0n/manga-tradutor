// Roda em toda página: atalhos, pedidos de tradução e os balões traduzidos.
// Tudo fica num shadow DOM fechado, para o CSS do site não bagunçar os balões (e vice-versa).
// Depende de atalhos.js (carregado antes).
if (!window.__mangaTradutor) {
  window.__mangaTradutor = true;
  (() => {
    const site = location.hostname;
    const CHAVES_PREF = ["fonte", "maiusculas", "idioma", "auto", "adiantar"];
    let atalhos = { ...ATALHOS_PADRAO };
    let pref = { fonte: "quadrinhos", maiusculas: false, idioma: "pt-BR", auto: {}, adiantar: "todas" };
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
        camada.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:block";
        raiz = camada.attachShadow({ mode: "closed" });
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = chrome.runtime.getURL("pagina.css");
        const carregou = new Promise((ok) => { css.onload = css.onerror = ok; });
        raiz.appendChild(css);
        raiz.addEventListener("mousedown", (e) => { if (menu && !menu.contains(e.target)) fecharMenu(); });
        lugarDaCamada().appendChild(camada);
        aplicarPref();
        await carregou;
      })());
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
    addEventListener("mousedown", (e) => {
      if (menu && e.target !== camada) fecharMenu();
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
        conectar().postMessage({ ...msg, rid });
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

    async function recortar() {
      await montar();
      const area = await selecionarArea();
      if (!area) return;
      comecarManual();
      await pedirPrint(area, true);
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
      const rid = pedir({ tipo: "imagem", url, w: el.naturalWidth, h: el.naturalHeight, faixa, prioridade, manual: manualmente });
      if (rid) cob.pend.set(rid, faixa);
      return rid;
    }

    /** Print de uma área da tela (sem nada nosso por cima na hora do print). */
    async function pedirPrint(area, manualmente, faixas) {
      await montar();
      const midias = listarMidias();
      const tela = { w: innerWidth, h: innerHeight, sx: scrollX, sy: scrollY };
      camada.style.visibility = "hidden";
      clearTimeout(reexibir);
      reexibir = setTimeout(mostrarCamada, 2500);
      await quadro();
      await quadro();
      return pedir({ tipo: "print", area, manual: manualmente, prioridade: manualmente ? 0 : 0.5 }, { midias, tela, faixas });
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
      if (tipo) timerAviso = setTimeout(() => d.remove(), tipo === "erro" ? 6000 : 2200);
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
      const cobre = document.createElement("div");
      cobre.className = "cobre";
      const txt = document.createElement("div");
      txt.className = "txt";
      txt.lang = pref.idioma || "pt-BR";
      el.append(cobre, txt);
      el.title = "Clique: ver o original · botão direito: mais opções";
      el.addEventListener("click", () => el.classList.toggle("original"));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        abrirMenu(e.clientX, e.clientY, b.chave);
      });
      raiz.appendChild(el);
      const reg = {
        el, cobre, txt, texto: "", ajustar: false, w: 0, h: 0, ancora, A0, sx: p.tela?.sx, sy: p.tela?.sy, geo: "",
        url: p.url, conteudo: p.tipo === "imagem", // pedido pela imagem: coordenadas no desenho da imagem
      };
      baloes.set(b.chave, reg);
      geometria(reg, b, p);
      substituirSobrepostos(b.chave, reg);
      return reg;
    }

    /** Posição relativa à âncora e à parte que cobre o texto original. Muda quando partes do mesmo balão se juntam. */
    function geometria(reg, b, p) {
      const geo = JSON.stringify([b.area, b.cobre]);
      if (geo === reg.geo) return;
      reg.geo = geo;
      const u = uniao(b.area, b.cobre);
      if (p.tipo === "imagem") reg.rel = u; // já vem normalizado na imagem
      else {
        const { w: W, h: H } = p.tela, A0 = reg.A0;
        reg.rel = {
          l: (u.l * W - A0.left) / A0.width, t: (u.t * H - A0.top) / A0.height,
          r: (u.r * W - A0.left) / A0.width, b: (u.b * H - A0.top) / A0.height,
        };
      }
      const w = u.r - u.l, h = u.b - u.t;
      Object.assign(reg.cobre.style, {
        left: ((b.cobre.l - u.l) / w) * 100 + "%", top: ((b.cobre.t - u.t) / h) * 100 + "%",
        width: ((b.cobre.r - b.cobre.l) / w) * 100 + "%", height: ((b.cobre.b - b.cobre.t) / h) * 100 + "%",
      });
      reg.el.classList.toggle("sobre-arte", !b.uniforme);
      reg.el.classList.toggle("escuro", !b.claro);
      reg.el.style.setProperty("--fundo", b.fundo);
      reg.w = reg.h = 0; // força reposicionar e reajustar a letra
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

    function remover(k) {
      baloes.get(k)?.el.remove();
      baloes.delete(k);
      contar();
    }
    // para diagnóstico e testes: quantos balões com tradução estão na página
    const contar = () => camada?.setAttribute("data-baloes", [...baloes.values()].filter((r) => r.texto).length);

    function posicionar() {
      const W = innerWidth, H = innerHeight;
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
        const fora = !c || c.t > H || c.b < 0 || c.l > W || c.r < 0;
        reg.el.style.display = fora ? "none" : "";
        if (fora) continue;
        const w = c.r - c.l, h = c.b - c.t;
        reg.el.style.transform = `translate(${c.l}px,${c.t}px)`;
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

    /**
     * Maior letra que cabe no balão (busca binária), nunca menor que 13 px: se não couber assim, a
     * tradução ganha uma caixa um pouco maior que o balão, mas continua legível.
     */
    const MINIMO = 13;
    function ajustarFonte(reg) {
      const t = reg.txt;
      reg.el.classList.remove("expandido");
      const cabe = () => t.scrollHeight <= t.clientHeight + 1 && t.scrollWidth <= t.clientWidth + 1;
      let lo = MINIMO, hi = Math.max(MINIMO, Math.min(30, reg.h * 0.42));
      t.style.fontSize = hi + "px";
      if (cabe()) return;
      t.style.fontSize = lo + "px";
      if (!cabe()) {
        reg.el.classList.add("expandido");
        return;
      }
      while (hi - lo > 0.5) {
        const meio = (lo + hi) / 2;
        t.style.fontSize = meio + "px";
        if (cabe()) lo = meio; else hi = meio;
      }
      t.style.fontSize = lo + "px";
    }

    let pedidoQuadro = 0;
    const agendarPosicao = () => {
      fecharMenu();
      if (baloes.size && !pedidoQuadro) pedidoQuadro = requestAnimationFrame(() => { pedidoQuadro = 0; posicionar(); });
    };

    // ---------- menu do botão direito ----------
    let menu = null;
    function abrirMenu(x, y, chave) {
      fecharMenu();
      const reg = baloes.get(chave);
      if (!reg) return;
      menu = document.createElement("div");
      menu.className = "menu";
      menu.setAttribute("role", "menu");
      const item = (texto, f) => {
        const b = document.createElement("button");
        b.setAttribute("role", "menuitem");
        b.textContent = texto;
        b.onclick = (e) => { e.stopPropagation(); f(); fecharMenu(); };
        menu.appendChild(b);
      };
      item(reg.el.classList.contains("original") ? "Ver tradução" : "Ver original", () => reg.el.classList.toggle("original"));
      item("Remover este balão", () => { removidos.add(chave); remover(chave); });
      if (baloes.size > 1) item(`Remover todos (${baloes.size})`, () => { for (const k of [...baloes.keys()]) { removidos.add(k); remover(k); } });
      raiz.appendChild(menu);
      const r = menu.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
      menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
      menu.querySelector("button").focus();
    }
    function fecharMenu() {
      menu?.remove();
      menu = null;
    }
  })();
}
