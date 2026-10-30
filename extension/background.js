import { lerConfig, faltaConfig } from "./config.js";
import { chamar } from "./provedores.js";
import {
  montarPrompt, montarPromptTexto, itensTexto, interpretar, interpretarTexto, parciais, parciaisTexto, pedacos, amostrar,
  analisarBalao, mesclar, textoContexto, nomesDe, juntarGlossario, obraDoTitulo, preencherBordas, linhasDoTsv,
  agruparLinhas, ocrConfiavel, faixasPorVaos,
} from "./tradutor.js";

// ---------- mensagens avulsas (popup e configurações) ----------
chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (msg.alvo) return; // é para o documento do OCR
  if (msg.tipo === "testar") {
    testar().then(responder, (e) => responder({ erro: e.message }));
    return true;
  }
  if (msg.tipo === "limparCache") {
    cache("limpar").then(() => responder(true));
    return true;
  }
  if (msg.tipo === "infoCache") {
    cache("contar").then((n) => responder(n ?? 0));
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
    await chrome.scripting.executeScript({ target: { tabId }, files: ["atalhos.js", "content.js"] }).catch(() => {});
    chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  }
}

// ---------- uma porta por página aberta ----------
// Quando a página fecha ou recarrega, a porta cai e tudo que ela pediu é cancelado (não gasta tokens à toa).
chrome.runtime.onConnect.addListener((porta) => {
  if (porta.name !== "mt") return;
  const est = {
    porta, controle: new AbortController(), contexto: [], emAndamento: new Map(), lote: null,
    tabId: porta.sender?.tab?.id, pagina: porta.sender?.url,
  };
  porta.onDisconnect.addListener(() => est.controle.abort());
  porta.onMessage.addListener((m) => {
    if (m.tipo === "prioridade") {
      for (const f of [filaApi, filaTela, filaLocal]) f.repriorizar(est, m.url, m.prioridade);
      return;
    }
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

const obraDe = (est, m) => {
  try { return obraDoTitulo(m.titulo, new URL(est.pagina).hostname); } catch { return ""; }
};

// ---------- filas: o que está na tela primeiro ----------
function criarFila(limite) {
  let ativos = 0;
  const fila = [];
  const proximo = () => {
    while (ativos < limite && fila.length) {
      const t = fila.shift();
      ativos++;
      t.f().then(t.ok, t.falha).finally(() => { ativos--; proximo(); });
    }
  };
  const ordenar = () => fila.sort((a, b) => a.prioridade - b.prioridade);
  const f = (prioridade, tarefa, dono = {}) => new Promise((ok, falha) => {
    fila.push({ prioridade, f: tarefa, ok, falha, ...dono });
    ordenar();
    proximo();
  });
  /** A página rolou: o que entrou na tela passa na frente do que ficou para trás. */
  f.repriorizar = (est, url, prioridade) => {
    for (const t of fila) if (t.est === est && t.url === url) t.prioridade = prioridade;
    ordenar();
  };
  f.ativos = () => ativos;
  return f;
}
const filaApi = criarFila(4); // chamadas à IA das páginas adiantadas
const filaTela = criarFila(8); // chamadas do que está na tela (uma por balão ou faixa): não esperam as adiantadas
const filaIa = (prioridade) => (prioridade < 1 ? filaTela : filaApi);
const filaLocal = criarFila(2); // baixar, recortar e ler (OCR) no PC: limita memória e processador
// o Chrome desliga o service worker parado há 30 s; uma chamada de API a cada 20 s o mantém vivo
// enquanto uma resposta lenta (modelos que "pensam") ainda está chegando
setInterval(() => {
  if (filaApi.ativos() || filaTela.ativos() || filaLocal.ativos()) chrome.runtime.getPlatformInfo();
}, 20000);

// Uma chamada por balão/faixa multiplica as chamadas por minuto. Se a API responder "limite" (429), este
// modelo volta a uma chamada por pedaço até o navegador fechar (planos grátis do Gemini, Claude nível 1…).
const semParalelo = new Set();
chrome.storage.session.get("semParalelo").then((s) => { for (const k of s.semParalelo || []) semParalelo.add(k); }, () => {});
const paralelo = (cfg) => cfg.porBalao && cfg.provedor !== "ollama" && !semParalelo.has(`${cfg.url}|${cfg.modelo}`);
async function chamarIa(cfg, pedido, opcoes) {
  try {
    return await chamar(cfg, pedido, opcoes);
  } catch (e) {
    const modelo = `${cfg.url}|${cfg.modelo}`;
    if (e.status === 429 && !semParalelo.has(modelo)) {
      semParalelo.add(modelo);
      chrome.storage.session.set({ semParalelo: [...semParalelo] }).catch(() => {});
    }
    throw e;
  }
}

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
// Guarda no máximo LIMITE_CACHE pedaços; passando disso, apaga os usados há mais tempo.
const LIMITE_CACHE = 20000;
let banco = null, gravacoes = 0;
function abrirBanco() {
  return (banco ??= new Promise((ok, falha) => {
    const r = indexedDB.open("manga-tradutor", 2);
    r.onupgradeneeded = () => {
      const db = r.result, tx = r.transaction;
      const loja = db.objectStoreNames.contains("cache") ? tx.objectStore("cache") : db.createObjectStore("cache");
      if (!loja.indexNames.contains("t")) loja.createIndex("t", "t");
      if (db.objectStoreNames.contains("traducoes")) { // versão 1: traz as traduções que já existiam
        tx.objectStore("traducoes").openCursor().onsuccess = (e) => {
          const c = e.target.result;
          if (!c) return db.deleteObjectStore("traducoes");
          loja.put({ v: c.value, t: Date.now() }, c.key);
          c.continue();
        };
      }
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { banco = null; falha(r.error); };
  }));
}
function pedirBanco(modo, f) {
  return abrirBanco().then((db) => new Promise((ok) => {
    const r = f(db.transaction("cache", modo).objectStore("cache"));
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ok(undefined);
  }));
}
async function cache(modo, chave, valor) {
  try {
    if (modo === "ler") {
      const reg = await pedirBanco("readonly", (l) => l.get(chave));
      if (reg && Date.now() - reg.t > 864e5) pedirBanco("readwrite", (l) => l.put({ v: reg.v, t: Date.now() }, chave)); // usado de novo
      return reg?.v;
    }
    if (modo === "gravar") {
      await pedirBanco("readwrite", (l) => l.put({ v: valor, t: Date.now() }, chave));
      if (++gravacoes % 200 === 1) podar();
      return;
    }
    if (modo === "contar") return await pedirBanco("readonly", (l) => l.count());
    return await pedirBanco("readwrite", (l) => l.clear());
  } catch {
    return undefined; // sem cache a tradução continua funcionando
  }
}
/** Passou do limite: apaga os mais antigos até sobrar 80%. */
async function podar(limite = LIMITE_CACHE) {
  const total = await pedirBanco("readonly", (l) => l.count());
  if (!(total > limite)) return 0;
  let sobra = total - Math.floor(limite * 0.8);
  const db = await abrirBanco();
  return new Promise((ok) => {
    const tx = db.transaction("cache", "readwrite");
    let apagados = 0;
    tx.objectStore("cache").index("t").openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (!c || sobra-- <= 0) return;
      c.delete();
      apagados++;
      c.continue();
    };
    tx.oncomplete = () => ok(apagados);
    tx.onerror = () => ok(apagados);
  });
}
globalThis.mtDiagnostico = { cache, podar, lerOcr: (c) => lerOcr(c) }; // para os testes (limite do cache, OCR)

// ---------- contador de uso (chamadas, tokens, economia do cache) ----------
const usoNovo = () => ({ chamadas: 0, entrada: 0, saida: 0, cache: 0, ocr: 0, estimado: 0 });
let usoMem = usoNovo();
const gravarUso = agendador(async () => {
  const d = usoMem;
  usoMem = usoNovo();
  const hoje = new Date().toLocaleDateString("sv"); // AAAA-MM-DD no fuso do PC
  const { uso = {} } = await chrome.storage.local.get("uso");
  if (uso.dia !== hoje) Object.assign(uso, { dia: hoje, hoje: usoNovo() });
  uso.total ??= usoNovo();
  for (const k of Object.keys(d)) { uso.hoje[k] = (uso.hoje[k] || 0) + d[k]; uso.total[k] = (uso.total[k] || 0) + d[k]; }
  await chrome.storage.local.set({ uso });
}, 1500);
function contarUso(campo, n = 1) {
  usoMem[campo] += n;
  gravarUso();
}

// ---------- glossário automático: nomes da obra aprendidos nas traduções ----------
let filaGlossario = Promise.resolve();
async function comGlossario(cfg, obra) {
  if (!cfg.aprender || !obra) return cfg;
  const { glossarios = {} } = await chrome.storage.local.get("glossarios");
  return { ...cfg, glossarioAuto: glossarios[obra]?.termos || [] };
}
function aprenderNomes(obra, novos) {
  if (!obra || !novos.length) return;
  filaGlossario = filaGlossario.then(async () => { // um de cada vez: duas respostas juntas não se atropelam
    const { glossarios = {} } = await chrome.storage.local.get("glossarios");
    glossarios[obra] = { t: Date.now(), termos: juntarGlossario(glossarios[obra]?.termos, novos) };
    const obras = Object.entries(glossarios).sort((a, b) => b[1].t - a[1].t).slice(0, 100);
    await chrome.storage.local.set({ glossarios: Object.fromEntries(obras) });
  }).catch(() => {});
}

/** Depois de cada resposta: conta o uso, aprende nomes, guarda as falas como contexto e a resposta crua. */
function registrar(est, cfg, obra, resposta, uso, textos) {
  contarUso("chamadas");
  contarUso("entrada", uso.entrada || 0);
  contarUso("saida", uso.saida || 0);
  if (uso.estimado) contarUso("estimado");
  if (cfg.aprender) aprenderNomes(obra, nomesDe(resposta));
  lembrar(est, textos);
  chrome.storage.session.set({ ultimaResposta: resposta.slice(0, 4000) }).catch(() => {});
}
function lembrar(est, textos) {
  for (const t of textos) if (t) est.contexto.push(t.slice(0, 90));
  est.contexto.splice(0, Math.max(0, est.contexto.length - 8));
}

// ---------- ler um pedaço: IA com imagem, ou OCR no PC + IA só com texto (inglês) ----------

/**
 * r: { canvas, pixels, tw, th, ocr? } de um pedaço já recortado. Devolve as falas com a caixa em
 * pixels do pedaço e a análise do balão: [{ id, px, texto, a }].
 */
async function lerPedaco(est, cfg, r, { prioridade, obra, dono, aoParcial }) {
  const analises = new Map();
  const entrada = (px, texto) => {
    const id = `${Math.round(px.l)},${Math.round(px.t)},${Math.round(px.r)},${Math.round(px.b)}`;
    let a = analises.get(id);
    if (!a) analises.set(id, (a = analisarBalao(r.pixels, px)));
    return { id, px: { l: px.l, t: px.t, r: px.r, b: px.b }, texto, a };
  };

  // modo inglês: o Tesseract já leu e a leitura foi boa; a IA só corrige e traduz (sem imagem, bem mais barato)
  const lido = r.ocr; // { grupos, linhas } quando o modo inglês leu este pedaço
  if (lido && ocrConfiavel(lido.grupos, lido.linhas)) {
    contarUso("ocr");
    if (!lido.grupos.length) return [];
    const base = lido.grupos.map((g) => entrada(g, ""));
    aoParcial(base); // os balões já ficam cobertos antes da IA responder
    const traduzidos = await traduzirTextos(est, cfg, lido.grupos.map((g) => g.texto), prioridade, obra,
      (parcial) => aoParcial(base.map((e, i) => ({ ...e, texto: parcial[i] ?? "" }))));
    return base.map((e, i) => ({ ...e, texto: traduzidos[i] })).filter((e) => e.texto);
  }

  // IA com imagem. Na tela, o pedaço vai em faixas cortadas nos vãos entre os quadros, todas ao mesmo
  // tempo: cada chamada só escreve os balões da sua faixa, então tudo chega bem antes.
  const coords = cfg.def.coords || "xy";
  const prompt = montarPrompt(await comGlossario(cfg, obra), coords);
  const faixas = (prioridade < 1 && paralelo(cfg) ? faixasPorVaos(r.pixels) : [[0, r.th]])
    .filter(([y0, y1]) => y1 - y0 === r.th || amostrar(r.pixels, { x: 0, y: y0, w: r.tw, h: y1 - y0 }).desvio >= 4);
  const listas = faixas.map(() => []);
  const lidas = await Promise.all(faixas.map(async ([y0, y1], i) => {
    const alt = y1 - y0;
    let canvas = r.canvas;
    if (alt !== r.th) {
      canvas = new OffscreenCanvas(r.tw, alt);
      canvas.getContext("2d").drawImage(r.canvas, 0, y0, r.tw, alt, 0, 0, r.tw, alt);
    }
    const imagem = await paraDataUrl(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 }));
    const daIa = (bs) => bs.map((b) => entrada({ l: b.l * r.tw, t: y0 + b.t * alt, r: b.r * r.tw, b: y0 + b.b * alt }, b.texto));
    const uso = {};
    const resposta = await filaIa(prioridade)(prioridade, () => {
      if (est.controle.signal.aborted) throw abortado();
      return chamarIa(cfg, { prompt, imagem, depois: textoContexto(est.contexto) }, {
        sinal: est.controle.signal, uso,
        aoTexto: (acum) => { listas[i] = daIa(parciais(acum, coords)); aoParcial(listas.flat()); },
      });
    }, dono);
    const lidoIa = interpretar(resposta, coords);
    registrar(est, cfg, obra, resposta, uso, lidoIa.map((b) => b.texto));
    return (listas[i] = daIa(lidoIa));
  }));
  return lidas.flat();
}

/**
 * Modo inglês: traduz o texto lido. O que está na tela vai na hora; páginas adiantadas esperam um
 * instante e vão juntas numa chamada só (menos chamadas, e a IA vê o diálogo em sequência).
 */
function traduzirTextos(est, cfg, textos, prioridade, obra, aoParcial) {
  if (prioridade < 1 && textos.length > 1 && paralelo(cfg)) return traduzirPorBalao(est, cfg, textos, prioridade, obra, aoParcial);
  return new Promise((ok, falha) => {
    const job = { textos, aoParcial, ok, falha, prioridade, obra };
    if (prioridade <= 0) return despachar(est, cfg, [job]);
    const lote = (est.lote ??= { jobs: [], timer: 0, cfg });
    lote.jobs.push(job);
    clearTimeout(lote.timer);
    const itens = lote.jobs.reduce((n, j) => n + j.textos.length, 0);
    if (lote.jobs.length >= 4 || itens >= 30) despachar(est, lote.cfg, lote.jobs.splice(0));
    else lote.timer = setTimeout(() => despachar(est, lote.cfg, lote.jobs.splice(0)), 350);
  });
}
async function despachar(est, cfg, jobs) {
  if (!jobs.length) return;
  if (est.lote && !est.lote.jobs.length) est.lote = null;
  try {
    const obra = jobs[0].obra;
    const todos = jobs.flatMap((j) => j.textos);
    const prompt = montarPromptTexto(await comGlossario(cfg, obra));
    const depois = [itensTexto(todos), textoContexto(est.contexto)].filter(Boolean).join("\n");
    const uso = {};
    const prioridade = Math.min(...jobs.map((j) => j.prioridade));
    const resposta = await filaIa(prioridade)(prioridade, () => {
      if (est.controle.signal.aborted) throw abortado();
      return chamarIa(cfg, { prompt, depois }, {
        sinal: est.controle.signal, uso,
        aoTexto: (acum) => {
          const p = parciaisTexto(acum);
          let k = 0;
          for (const j of jobs) { j.aoParcial(p.slice(k, k + j.textos.length)); k += j.textos.length; }
        },
      });
    });
    const traduzidos = interpretarTexto(resposta, todos.length);
    registrar(est, cfg, obra, resposta, uso, traduzidos);
    let k = 0;
    for (const j of jobs) j.ok(traduzidos.slice(k, (k += j.textos.length)));
  } catch (e) {
    for (const j of jobs) j.falha(e);
  }
}

/**
 * O que está na tela, no modo inglês: uma chamada por balão, todas ao mesmo tempo. Cada uma vê os
 * balões da página inteira (para a tradução ficar coerente), mas escreve só o seu: o último balão
 * chega quase junto com o primeiro, em vez de esperar a IA escrever todos em sequência.
 */
async function traduzirPorBalao(est, cfg, textos, prioridade, obra, aoParcial) {
  const comNomes = await comGlossario(cfg, obra);
  const pagina = [itensTexto(textos), textoContexto(est.contexto)].filter(Boolean).join("\n");
  const parcial = textos.map(() => "");
  const traduzidos = await Promise.all(textos.map(async (_, i) => {
    // só a primeira anota nomes novos da obra: as outras repetiriam os mesmos (tokens à toa)
    const prompt = montarPromptTexto({ ...comNomes, aprender: comNomes.aprender && i === 0 }, true);
    const uso = {};
    const resposta = await filaTela(prioridade, () => {
      if (est.controle.signal.aborted) throw abortado();
      return chamarIa(cfg, { prompt, depois: `${pagina}\nTranslate item ${i + 1}.` }, {
        sinal: est.controle.signal, uso,
        aoTexto: (acum) => { parcial[i] = parciaisTexto(acum)[0] ?? ""; aoParcial(parcial.slice()); },
      });
    });
    registrar(est, cfg, obra, resposta, uso, []);
    return (parcial[i] = interpretarTexto(resposta, 1)[0]);
  }));
  lembrar(est, traduzidos); // na ordem de leitura, não na ordem em que as respostas chegaram
  return traduzidos;
}

// ---------- OCR (Tesseract) num documento invisível da extensão ----------
let ocrPronto = null;
function garantirOcr() {
  return (ocrPronto ??= (async () => {
    if (!chrome.offscreen) { // Firefox: o background é uma página; o documento do OCR entra nela como iframe
      const f = document.createElement("iframe");
      await new Promise((ok, falha) => { f.onload = ok; f.onerror = falha; f.src = "ocr.html"; document.body.appendChild(f); });
      return;
    }
    const existe = (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length;
    if (!existe) {
      await chrome.offscreen.createDocument({
        url: "ocr.html", reasons: ["WORKERS"], justification: "Ler o texto das páginas em inglês no próprio PC (Tesseract)",
      });
    }
  })().catch((e) => { ocrPronto = null; throw e; }));
}
/** O que o OCR leu no pedaço ({ grupos (um por balão), linhas }), ou null se ele não estiver disponível. */
async function lerOcr(canvas) {
  try {
    await garantirOcr();
    const png = await paraDataUrl(await canvas.convertToBlob({ type: "image/png" }));
    const r = await chrome.runtime.sendMessage({ alvo: "ocr", imagem: png });
    if (!r || r.erro) throw new Error(r?.erro || "o OCR não respondeu");
    const linhas = linhasDoTsv(r.tsv);
    return { grupos: agruparLinhas(linhas), linhas };
  } catch (e) {
    console.warn("OCR indisponível, vai pela IA com imagem:", e);
    ocrPronto = null;
    return null;
  }
}

/** Texto sobre o desenho: reconstrói o fundo atrás dele (imagem pequena que a página estica por cima). */
async function comRemendos(itens, pixels, paraPx) {
  return Promise.all(itens.map(async (it) => {
    if (it.uniforme || !it.texto) return it;
    const rem = preencherBordas(pixels, paraPx(it.cobre), 96);
    const c = new OffscreenCanvas(rem.w, rem.h);
    c.getContext("2d").putImageData(new ImageData(rem.data, rem.w, rem.h), 0, 0);
    return { ...it, remendo: await paraDataUrl(await c.convertToBlob({ type: "image/jpeg", quality: 0.85 })) };
  }));
}

// ---------- tradução pela imagem original ----------
// Usa os pixels da própria imagem (não um print): não depende da rolagem e dá para traduzir páginas
// que ainda nem apareceram na tela. O cache vale pelo endereço (sem nem baixar a imagem) e, se o
// endereço mudou, pelo conteúdo do arquivo.
const imagens = new Map(); // endereço → Promise<{ assinatura, bitmap() }>, só as últimas (memória)

async function traduzirImagem(est, m) {
  const cfg = await configPronta(m.manual);
  const obra = obraDe(est, m);
  const idUrl = hashTexto(m.url);
  const [y0, y1] = m.faixa || [0, 1];
  // recorte (m.area, em pixels da imagem): só a parte marcada; senão, a faixa pedida da imagem inteira
  const partes = m.area
    ? pedacos(m.area).map((q) => ({ ...q, i: `a${q.x},${q.y}` }))
    : pedacos({ x: 0, y: 0, w: m.w, h: m.h }).map((q, i) => ({ ...q, i }))
      .filter((q) => q.dono.y1 > y0 * m.h && q.dono.y0 < y1 * m.h);

  const listas = partes.map(() => []);
  let prontos = 0;
  const atualizar = agendador(() => enviar(est, { rid: m.rid, tipo: "parcial", lista: listas.flat(), prontos, total: partes.length }));
  const resultados = await Promise.allSettled(partes.map(async (q, k) => {
    const chaveCache = `${cfg.idioma}|${m.url}|${q.x},${q.y},${q.w},${q.h}`;
    let itens = await cache("ler", chaveCache);
    if (itens) contarUso("cache");
    else {
      let p = est.emAndamento.get(chaveCache); // o mesmo pedaço pedido de novo antes de terminar
      if (!p) {
        p = traduzirPedacoImagem(est, cfg, m, q, idUrl, obra, (parcial) => {
          listas[k] = parcial;
          atualizar();
        });
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

async function traduzirPedacoImagem(est, cfg, m, q, idUrl, obra, aoParcial) {
  const dono = { est, url: m.url };
  const trocarChave = (it) => ({ ...it, chave: it.chave.replace(/^i\|[^|]*\|/, `i|${idUrl}|`) });
  // parte local (baixar, recortar, ler): numa fila própria, para não ocupar a vez das chamadas à IA
  const r = await filaLocal(m.prioridade, async () => {
    if (est.controle.signal.aborted) throw abortado();
    const arquivo = await baixar(m.url, est.pagina);
    // mesma imagem com outro endereço (links que expiram, servidores que mudam a cada visita): reaproveita
    const chaveConteudo = `${cfg.idioma}|#${arquivo.assinatura}|${q.x},${q.y},${q.w},${q.h}`;
    const salvo = await cache("ler", chaveConteudo);
    if (salvo) {
      contarUso("cache");
      return { itens: salvo.map(trocarChave) };
    }
    const img = await arquivo.bitmap();
    // m.w/m.h são do <img> na página; a imagem baixada pode vir noutro tamanho
    const fx = img.width / m.w, fy = img.height / m.h;
    const tw = Math.max(1, Math.round(q.w * fx)), th = Math.max(1, Math.round(q.h * fy));
    const canvas = new OffscreenCanvas(tw, th);
    const g = canvas.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, q.x * fx, q.y * fy, q.w * fx, q.h * fy, 0, 0, tw, th);
    const pixels = g.getImageData(0, 0, tw, th);
    if (amostrar(pixels, { x: 0, y: 0, w: tw, h: th }).desvio < 4) return { itens: [] }; // pedaço liso
    return { canvas, pixels, tw, th, chaveConteudo, ocr: m.ocr ? await lerOcr(canvas) : null };
  }, dono);
  if (r.itens) return r.itens;

  const norm = (c) => ({
    l: (q.x + (c.l / r.tw) * q.w) / m.w, t: (q.y + (c.t / r.th) * q.h) / m.h,
    r: (q.x + (c.r / r.tw) * q.w) / m.w, b: (q.y + (c.b / r.th) * q.h) / m.h,
  });
  const paraItens = (entradas) => mesclar(entradas.flatMap((e) => {
    const cx = q.x + ((e.px.l + e.px.r) / 2 / r.tw) * q.w, cy = q.y + ((e.px.t + e.px.b) / 2 / r.th) * q.h;
    if (cx < q.dono.x0 || cx > q.dono.x1 || cy < q.dono.y0 || cy > q.dono.y1) return []; // é de outro pedaço
    return [{
      chave: `i|${idUrl}|${q.i}|${e.id}`, texto: e.texto,
      fundo: e.a.fundo, claro: e.a.claro, uniforme: e.a.uniforme, cobre: norm(e.a.cobre), area: norm(e.a.area),
    }];
  }));
  const entradas = await lerPedaco(est, cfg, r, { prioridade: m.prioridade, obra, dono, aoParcial: (es) => aoParcial(paraItens(es)) });
  const itens = await comRemendos(paraItens(entradas), r.pixels, (c) => ({
    l: ((c.l * m.w - q.x) / q.w) * r.tw, t: ((c.t * m.h - q.y) / q.h) * r.th,
    r: ((c.r * m.w - q.x) / q.w) * r.tw, b: ((c.b * m.h - q.y) / q.h) * r.th,
  }));
  cache("gravar", r.chaveConteudo, itens);
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
  let bitmap = null; // só decodifica se precisar ler a imagem
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
  await chrome.declarativeNetRequest?.updateSessionRules({
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
  const obra = obraDe(est, m);
  const tab = await chrome.tabs.get(est.tabId);
  if (!tab.active) throw new Error("a aba precisa estar visível");
  const print = await capturar(tab.windowId);
  enviar(est, { rid: m.rid, tipo: "capturado" });
  const bitmap = await createImageBitmap(await (await fetch(print)).blob());
  const W = bitmap.width, H = bitmap.height;
  const tela = new OffscreenCanvas(W, H).getContext("2d", { willReadFrequently: true });
  tela.drawImage(bitmap, 0, 0);
  const pixels = tela.getImageData(0, 0, W, H);
  const partes = pedacos({ x: m.area.x * W, y: m.area.y * H, w: m.area.w * W, h: m.area.h * H });
  const dono = { est, url: "" };

  const listas = partes.map(() => []);
  let prontos = 0;
  const atualizar = agendador(() => enviar(est, { rid: m.rid, tipo: "parcial", lista: listas.flat(), prontos, total: partes.length }));
  const resultados = await Promise.allSettled(partes.map(async (q, i) => {
    const { hash, desvio } = amostrar(pixels, q);
    if (desvio < 4) { prontos++; return atualizar(); } // pedaço liso: nada a traduzir
    const qx = Math.round(q.x), qy = Math.round(q.y);
    const r = await filaLocal(m.prioridade, async () => {
      if (est.controle.signal.aborted) throw abortado();
      const tw = Math.max(1, Math.round(q.w)), th = Math.max(1, Math.round(q.h));
      const canvas = new OffscreenCanvas(tw, th);
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.drawImage(bitmap, qx, qy, tw, th, 0, 0, tw, th);
      return { canvas, pixels: g.getImageData(0, 0, tw, th), tw, th };
    }, dono);
    const paraItens = (entradas) => mesclar(entradas.flatMap((e) => {
      const cx = qx + (e.px.l + e.px.r) / 2, cy = qy + (e.px.t + e.px.b) / 2;
      if (cx < q.dono.x0 || cx > q.dono.x1 || cy < q.dono.y0 || cy > q.dono.y1) return [];
      const tela = (c) => ({ l: (qx + c.l) / W, t: (qy + c.t) / H, r: (qx + c.r) / W, b: (qy + c.b) / H });
      return [{
        chave: `p|${m.rid}|${qx + Math.round(e.px.l)},${qy + Math.round(e.px.t)}`, texto: e.texto,
        fundo: e.a.fundo, claro: e.a.claro, uniforme: e.a.uniforme, cobre: tela(e.a.cobre), area: tela(e.a.area),
      }];
    }));
    // o cache do print guarda as falas (caixa no pedaço + texto); a análise do balão é refeita na hora
    const chaveCache = `${cfg.idioma}|p|${hash}`;
    const salvo = await cache("ler", chaveCache);
    let entradas;
    if (salvo) {
      contarUso("cache");
      entradas = salvo.map((s) => {
        const px = { l: s.l * r.tw, t: s.t * r.th, r: s.r * r.tw, b: s.b * r.th };
        return { id: "", px, texto: s.texto, a: analisarBalao(r.pixels, px) };
      });
    } else {
      if (m.ocr) r.ocr = await filaLocal(m.prioridade, () => lerOcr(r.canvas), dono);
      entradas = await lerPedaco(est, cfg, r, {
        prioridade: m.prioridade, obra, dono,
        aoParcial: (es) => { listas[i] = paraItens(es); atualizar(); },
      });
      cache("gravar", chaveCache, entradas.map((e) => ({ l: e.px.l / r.tw, t: e.px.t / r.th, r: e.px.r / r.tw, b: e.px.b / r.th, texto: e.texto })));
    }
    listas[i] = await comRemendos(paraItens(entradas), pixels, (c) => ({ l: c.l * W, t: c.t * H, r: c.r * W, b: c.b * H }));
    prontos++;
    atualizar();
  }));
  atualizar.cancelar();
  const falha = resultados.find((r) => r.status === "rejected");
  if (falha && listas.every((l) => !l.length)) throw falha.reason;
  enviar(est, { rid: m.rid, tipo: "fim", lista: listas.flat(), total: partes.length });
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
  const uso = {};
  const resposta = await chamar(cfg, { prompt: montarPrompt(cfg, coords), imagem }, { uso });
  registrar({ contexto: [] }, cfg, "", resposta, uso, []);
  return { ms: Date.now() - inicio, baloes: interpretar(resposta, coords), bruto: resposta.slice(0, 1500) };
}
