import { lerConfig, faltaConfig } from "./config.js";
import { chamar } from "./provedores.js";
import {
  montarPrompt, interpretar, parciais, paraTela, pedacos, amostrar, analisarBalao, mesclar, textoContexto,
} from "./tradutor.js";

// ---------- mensagens avulsas (popup e configurações) ----------
chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (msg.tipo === "testar") {
    testar().then(responder, (e) => responder({ erro: e.message }));
    return true;
  }
  if (msg.tipo === "limparCache") {
    cache("limpar").then(() => responder(true));
    return true;
  }
  if (msg.acao) chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab && dispararNaAba(tab.id, msg.acao));
});

/** O popup pede a ação; quem executa é a página. Se ela foi aberta antes da extensão, injeta o script antes. */
async function dispararNaAba(tabId, acao) {
  const msg = { tipo: "disparar", acao };
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["fontes.css"] }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId }, files: ["atalhos.js", "content.js"] }).catch(() => {});
    chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  }
}

// ---------- uma porta por página aberta ----------
// Quando a página fecha ou recarrega, a porta cai e tudo que ela pediu é cancelado (não gasta tokens à toa).
chrome.runtime.onConnect.addListener((porta) => {
  if (porta.name !== "mt") return;
  const est = {
    porta, controle: new AbortController(), contexto: [], emAndamento: new Map(),
    tabId: porta.sender?.tab?.id, pagina: porta.sender?.url,
  };
  porta.onDisconnect.addListener(() => est.controle.abort());
  porta.onMessage.addListener((m) => {
    if (m.tipo === "prioridade") return filaApi.repriorizar(est, m.url, m.prioridade);
    const tarefa = m.tipo === "imagem" ? traduzirImagem(est, m) : m.tipo === "print" ? traduzirPrint(est, m) : null;
    tarefa?.catch((e) => {
      if (e.name !== "AbortError") enviar(est, { rid: m.rid, tipo: "erro", msg: e.message, semImagem: !!e.semImagem });
    });
  });
});

function enviar(est, msg) {
  try { est.porta.postMessage(msg); } catch { /* página já fechou */ }
}

async function configPronta(manual) {
  const cfg = await lerConfig();
  const falta = faltaConfig(cfg);
  if (falta) {
    if (manual) chrome.runtime.openOptionsPage();
    throw new Error(`${falta} — veja as configurações`);
  }
  return cfg;
}

// ---------- fila das chamadas à IA: no máximo 4 ao mesmo tempo, o que está na tela primeiro ----------
const filaApi = (() => {
  let ativos = 0;
  const fila = [];
  const proximo = () => {
    while (ativos < 4 && fila.length) {
      const t = fila.shift();
      ativos++;
      t.f().then(t.ok, t.falha).finally(() => { ativos--; proximo(); });
    }
  };
  const ordenar = () => fila.sort((a, b) => a.prioridade - b.prioridade);
  // o Chrome desliga o service worker parado há 30 s; uma chamada de API a cada 20 s o mantém vivo
  // enquanto uma resposta lenta (modelos que "pensam") ainda está chegando
  setInterval(() => { if (ativos) chrome.runtime.getPlatformInfo(); }, 20000);
  const filaApi = (prioridade, f, dono = {}) => new Promise((ok, falha) => {
    fila.push({ prioridade, f, ok, falha, ...dono });
    ordenar();
    proximo();
  });
  /** A página rolou: o que entrou na tela passa na frente do que ficou para trás. */
  filaApi.repriorizar = (est, url, prioridade) => {
    for (const t of fila) if (t.est === est && t.url === url) t.prioridade = prioridade;
    ordenar();
  };
  return filaApi;
})();

const abortado = () => new DOMException("cancelado", "AbortError");

/** Agrupa atualizações seguidas num envio só. */
function agendador(f, ms = 60) {
  let t = 0;
  const g = () => { t ||= setTimeout(() => { t = 0; f(); }, ms); };
  g.cancelar = () => { clearTimeout(t); t = 0; };
  return g;
}

// ---------- cache das traduções (IndexedDB: grande, sobrevive ao fechar o navegador) ----------
// A chave não inclui a IA: trocar de API continua mostrando o que já foi traduzido, sem gastar de novo.
// shortcut: nada é apagado sozinho; se um dia pesar, guardar a data e podar os mais antigos.
let banco = null;
function abrirBanco() {
  return (banco ??= new Promise((ok, falha) => {
    const r = indexedDB.open("manga-tradutor", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("traducoes");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { banco = null; falha(r.error); };
  }));
}
async function cache(modo, chave, valor) {
  try {
    const db = await abrirBanco();
    return await new Promise((ok) => {
      const loja = db.transaction("traducoes", modo === "ler" ? "readonly" : "readwrite").objectStore("traducoes");
      const r = modo === "ler" ? loja.get(chave) : modo === "gravar" ? loja.put(valor, chave) : loja.clear();
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(undefined);
    });
  } catch {
    return undefined; // sem cache a tradução continua funcionando
  }
}

/** Guarda as últimas falas (contexto para os próximos pedaços) e a resposta crua (diagnóstico). */
function lembrar(est, itens, resposta) {
  for (const it of itens) if (it.texto) est.contexto.push(it.texto.slice(0, 90));
  est.contexto.splice(0, Math.max(0, est.contexto.length - 8));
  chrome.storage.session.set({ ultimaResposta: resposta.slice(0, 4000) }).catch(() => {});
}

// ---------- tradução pela imagem original ----------
// Usa os pixels da própria imagem (não um print): não depende da rolagem e dá para traduzir páginas
// que ainda nem apareceram na tela. O cache vale pelo endereço (sem nem baixar a imagem) e, se o
// endereço mudou, pelo conteúdo do arquivo.
const imagens = new Map(); // endereço → Promise<{ assinatura, bitmap() }>, só as últimas (memória)

async function traduzirImagem(est, m) {
  const cfg = await configPronta(m.manual);
  const coords = cfg.def.coords || "xy";
  const prompt = montarPrompt(cfg, coords);
  const idUrl = hashTexto(m.url);
  const [y0, y1] = m.faixa;
  const partes = pedacos({ x: 0, y: 0, w: m.w, h: m.h }).map((q, i) => ({ ...q, i }))
    .filter((q) => q.dono.y1 > y0 * m.h && q.dono.y0 < y1 * m.h);

  const listas = partes.map(() => []);
  let prontos = 0;
  const atualizar = agendador(() => enviar(est, { rid: m.rid, tipo: "parcial", lista: listas.flat(), prontos, total: partes.length }));
  const resultados = await Promise.allSettled(partes.map(async (q, k) => {
    const chaveCache = `${cfg.idioma}|${m.url}|${q.x},${q.y},${q.w},${q.h}`;
    let itens = await cache("ler", chaveCache);
    if (!itens) {
      let p = est.emAndamento.get(chaveCache); // o mesmo pedaço pedido de novo antes de terminar
      if (!p) {
        p = filaApi(m.prioridade, () => traduzirPedacoImagem(est, cfg, coords, prompt, m, q, idUrl, (parcial) => {
          listas[k] = parcial;
          atualizar();
        }), { est, url: m.url });
        est.emAndamento.set(chaveCache, p);
        p.then((v) => cache("gravar", chaveCache, v), () => {}).finally(() => est.emAndamento.delete(chaveCache));
      }
      itens = await p;
    }
    listas[k] = itens;
    prontos++;
    atualizar();
  }));
  atualizar.cancelar();
  const falha = resultados.find((r) => r.status === "rejected");
  if (falha && listas.every((l) => !l.length)) throw falha.reason;
  enviar(est, { rid: m.rid, tipo: "fim", lista: listas.flat(), total: partes.length });
}

async function traduzirPedacoImagem(est, cfg, coords, prompt, m, q, idUrl, aoParcial) {
  if (est.controle.signal.aborted) throw abortado();
  const arquivo = await baixar(m.url, est.pagina);
  // mesma imagem com outro endereço (links que expiram, servidores que mudam a cada visita): reaproveita
  const chaveConteudo = `${cfg.idioma}|#${arquivo.assinatura}|${q.x},${q.y},${q.w},${q.h}`;
  const salvo = await cache("ler", chaveConteudo);
  if (salvo) return salvo.map((it) => ({ ...it, chave: it.chave.replace(/^i\|[^|]*\|/, `i|${idUrl}|`) }));
  const img = await arquivo.bitmap();
  // m.w/m.h são do <img> na página; a imagem baixada pode vir noutro tamanho
  const fx = img.width / m.w, fy = img.height / m.h;
  const tw = Math.max(1, Math.round(q.w * fx)), th = Math.max(1, Math.round(q.h * fy));
  const canvas = new OffscreenCanvas(tw, th);
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, q.x * fx, q.y * fy, q.w * fx, q.h * fy, 0, 0, tw, th);
  const pixels = g.getImageData(0, 0, tw, th);
  if (amostrar(pixels, { x: 0, y: 0, w: tw, h: th }).desvio < 4) return []; // pedaço liso: nada a traduzir
  const recorte = await paraDataUrl(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 }));

  const analises = new Map();
  const processar = (bs) => mesclar(bs.flatMap((b) => {
    const cx = q.x + ((b.l + b.r) / 2) * q.w, cy = q.y + ((b.t + b.b) / 2) * q.h;
    if (cx < q.dono.x0 || cx > q.dono.x1 || cy < q.dono.y0 || cy > q.dono.y1) return []; // é de outro pedaço
    const px = { l: b.l * tw, t: b.t * th, r: b.r * tw, b: b.b * th };
    const id = `${Math.round(px.l)},${Math.round(px.t)},${Math.round(px.r)},${Math.round(px.b)}`;
    let a = analises.get(id);
    if (!a) analises.set(id, (a = analisarBalao(pixels, px)));
    const norm = (c) => ({
      l: (q.x + (c.l / tw) * q.w) / m.w, t: (q.y + (c.t / th) * q.h) / m.h,
      r: (q.x + (c.r / tw) * q.w) / m.w, b: (q.y + (c.b / th) * q.h) / m.h,
    });
    return [{
      chave: `i|${idUrl}|${q.i}|${id}`, texto: b.texto,
      fundo: a.fundo, claro: a.claro, uniforme: a.uniforme, cobre: norm(a.cobre), area: norm(a.area),
    }];
  }));
  const resposta = await chamar(cfg, recorte, prompt, (acum) => aoParcial(processar(parciais(acum, coords))),
    est.controle.signal, textoContexto(est.contexto));
  const itens = processar(interpretar(resposta, coords));
  lembrar(est, itens, resposta);
  cache("gravar", chaveConteudo, itens);
  return itens;
}

function baixar(url, pagina) {
  let p = imagens.get(url);
  if (!p) {
    p = baixarImagem(url, pagina);
    imagens.set(url, p);
    p.catch(() => imagens.delete(url));
    if (imagens.size > 4) imagens.delete(imagens.keys().next().value);
  }
  return p;
}

async function baixarImagem(url, pagina) {
  const erro = (msg) => Object.assign(new Error(msg), { semImagem: true });
  if (!/^(https?|data):/.test(url)) throw erro("endereço de imagem não suportado");
  await liberarReferer(url, pagina);
  let r;
  try { r = await fetch(url, { credentials: "include" }); } catch { throw erro("não consegui baixar a imagem"); }
  if (!r.ok) throw erro(`a imagem respondeu ${r.status}`);
  const bytes = await r.arrayBuffer();
  const tipo = r.headers.get("content-type") || "";
  // impressão digital do arquivo (~5 ms por MB): identifica a mesma página em outro endereço
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const assinatura = [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  let bitmap = null; // só decodifica se precisar chamar a IA
  return {
    assinatura,
    bitmap: () => (bitmap ??= createImageBitmap(new Blob([bytes], { type: tipo })).catch(() => {
      throw erro("formato de imagem não suportado");
    })),
  };
}

/**
 * Muitos sites de mangá só entregam a imagem para quem vem deles (Referer). Uma regra de sessão põe o
 * Referer do site nos pedidos da própria extensão (tabIds -1), nunca na navegação normal.
 */
const referers = new Map();
async function liberarReferer(url, pagina) {
  if (!/^https?:/.test(url) || !/^https?:/.test(pagina || "")) return;
  const host = new URL(url).hostname, referer = new URL(pagina).origin + "/";
  if (referers.get(host) === referer) return;
  referers.set(host, referer);
  const id = 1 + (parseInt(hashTexto(host), 36) % 100000);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{
      id, priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: referer }] },
      condition: { requestDomains: [host], tabIds: [chrome.tabs.TAB_ID_NONE] },
    }],
  }).catch(() => {});
}

// ---------- tradução por print (recorte, canvas, imagens que não dá para baixar) ----------
let ultimoPrint = 0;
async function capturar(windowId) {
  const falta = ultimoPrint + 550 - Date.now(); // o Chrome aceita ~2 prints por segundo
  if (falta > 0) await new Promise((ok) => setTimeout(ok, falta));
  ultimoPrint = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 92 });
}

async function traduzirPrint(est, m) {
  const cfg = await configPronta(m.manual);
  const tab = await chrome.tabs.get(est.tabId);
  if (!tab.active) throw new Error("a aba precisa estar visível");
  const print = await capturar(tab.windowId);
  enviar(est, { rid: m.rid, tipo: "capturado" });
  const bitmap = await createImageBitmap(await (await fetch(print)).blob());
  const W = bitmap.width, H = bitmap.height;
  const tela = new OffscreenCanvas(W, H).getContext("2d", { willReadFrequently: true });
  tela.drawImage(bitmap, 0, 0);
  const pixels = tela.getImageData(0, 0, W, H);

  const coords = cfg.def.coords || "xy";
  const prompt = montarPrompt(cfg, coords);
  const partes = pedacos({ x: m.area.x * W, y: m.area.y * H, w: m.area.w * W, h: m.area.h * H });
  const analises = new Map();
  const processar = (bs, q) => mesclar(paraTela(bs, { x: q.x / W, y: q.y / H, w: q.w / W, h: q.h / H }).flatMap((b) => {
    const px = { l: b.l * W, t: b.t * H, r: b.r * W, b: b.b * H };
    const cx = (px.l + px.r) / 2, cy = (px.t + px.b) / 2;
    if (cx < q.dono.x0 || cx > q.dono.x1 || cy < q.dono.y0 || cy > q.dono.y1) return [];
    const id = `${Math.round(px.l)},${Math.round(px.t)},${Math.round(px.r)},${Math.round(px.b)}`;
    let a = analises.get(id);
    if (!a) analises.set(id, (a = analisarBalao(pixels, px)));
    const norm = (c) => ({ l: c.l / W, t: c.t / H, r: c.r / W, b: c.b / H });
    return [{ chave: `p|${m.rid}|${id}`, texto: b.texto, fundo: a.fundo, claro: a.claro, uniforme: a.uniforme, cobre: norm(a.cobre), area: norm(a.area) }];
  }));

  const listas = partes.map(() => []);
  let prontos = 0;
  const atualizar = agendador(() => enviar(est, { rid: m.rid, tipo: "parcial", lista: listas.flat(), prontos, total: partes.length }));
  const resultados = await Promise.allSettled(partes.map(async (q, i) => {
    const { hash, desvio } = amostrar(pixels, q);
    if (desvio >= 4) { // pedaço liso não tem o que traduzir
      const chaveCache = `${cfg.idioma}|p|${hash}`;
      let bs = await cache("ler", chaveCache);
      if (!bs) {
        bs = await filaApi(m.prioridade, async () => {
          if (est.controle.signal.aborted) throw abortado();
          const recorte = await recortar(bitmap, q);
          const resposta = await chamar(cfg, recorte, prompt, (acum) => {
            listas[i] = processar(parciais(acum, coords), q);
            atualizar();
          }, est.controle.signal, textoContexto(est.contexto));
          const lido = interpretar(resposta, coords);
          lembrar(est, lido, resposta);
          return lido;
        });
        cache("gravar", chaveCache, bs);
      }
      listas[i] = processar(bs, q);
    }
    prontos++;
    atualizar();
  }));
  atualizar.cancelar();
  const falha = resultados.find((r) => r.status === "rejected");
  if (falha && listas.every((l) => !l.length)) throw falha.reason;
  enviar(est, { rid: m.rid, tipo: "fim", lista: listas.flat(), total: partes.length });
}

/** Corta o pedaço {x,y,w,h} (pixels) do print e devolve um data URL JPEG. */
async function recortar(bitmap, q) {
  const w = Math.max(1, Math.round(q.w)), h = Math.max(1, Math.round(q.h));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, q.x, q.y, w, h, 0, 0, w, h);
  return paraDataUrl(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 }));
}

function paraDataUrl(blob) {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => falha(r.error);
    r.readAsDataURL(blob);
  });
}

function hashTexto(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Botão "Testar" das configurações: um balão de exemplo, para conferir chave, modelo e coordenadas. */
async function testar() {
  const cfg = await lerConfig();
  const falta = faltaConfig(cfg);
  if (falta) return { erro: falta };
  const c = new OffscreenCanvas(640, 400);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 640, 400);
  g.lineWidth = 4; g.strokeStyle = "#000";
  g.beginPath(); g.ellipse(320, 190, 230, 120, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#000"; g.font = "bold 38px sans-serif"; g.textAlign = "center";
  g.fillText("WHERE DID", 320, 175); g.fillText("HE GO?!", 320, 225);
  const imagem = await paraDataUrl(await c.convertToBlob({ type: "image/jpeg", quality: 0.9 }));
  const coords = cfg.def.coords || "xy";
  const inicio = Date.now();
  const resposta = await chamar(cfg, imagem, montarPrompt(cfg, coords));
  return { ms: Date.now() - inicio, baloes: interpretar(resposta, coords), bruto: resposta.slice(0, 1500) };
}
