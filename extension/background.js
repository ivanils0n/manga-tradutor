import { lerConfig, faltaConfig } from "./config.js";
import { chamar } from "./provedores.js";
import { montarPrompt, interpretar, parciais, paraTela, pedacos, amostrar, analisarBalao } from "./tradutor.js";

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  if (msg.tipo === "testar") {
    testar().then(responder, (e) => responder({ erro: e.message }));
    return true;
  }
  if (!msg.acao) return;
  const rodar = (tab) => tab && executar(msg.acao, tab, msg.auto);
  if (remetente.tab) rodar(remetente.tab);
  else chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => rodar(tab)); // veio do popup
});

/** Manda mensagem para a página; se ela foi aberta antes da extensão, injeta o script e tenta de novo. */
async function falar(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["fontes.css"] }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId }, files: ["atalhos.js", "content.js"] });
    return chrome.tabs.sendMessage(tabId, msg);
  }
}

// O Chrome limita o print da aba a ~2 por segundo.
let ultimoPrint = 0;
async function capturar(windowId) {
  const falta = ultimoPrint + 550 - Date.now();
  if (falta > 0) await new Promise((ok) => setTimeout(ok, falta));
  ultimoPrint = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 92 });
}

/** Executa no máximo `n` tarefas ao mesmo tempo. */
function limitador(n) {
  let ativos = 0;
  const fila = [];
  const proximo = () => {
    if (ativos >= n || !fila.length) return;
    ativos++;
    const { f, ok, falha } = fila.shift();
    f().then(ok, falha).finally(() => { ativos--; proximo(); });
  };
  return (f) => new Promise((ok, falha) => { fila.push({ f, ok, falha }); proximo(); });
}

const controles = new Map(); // aba → tradução manual em andamento (para cancelar ao começar outra)
let ultima = 0;

async function executar(acao, tab, auto = false) {
  if (acao === "alternar") return falar(tab.id, { tipo: "alternar" }).catch(() => {});
  const cfg = await lerConfig();
  const falta = faltaConfig(cfg);
  if (falta) {
    if (!auto) chrome.runtime.openOptionsPage();
    return;
  }
  if (!auto) controles.get(tab.id)?.abort(); // a nova tradução substitui a anterior: não gasta tokens à toa
  const controle = new AbortController();
  if (!auto) controles.set(tab.id, controle);

  const id = ++ultima;
  let area;
  try { area = await falar(tab.id, { tipo: "preparar", acao, id, auto }); } catch { return; } // página interna do navegador
  if (!area) return; // recorte cancelado ou nada novo na tela

  const enviar = (m) => chrome.tabs.sendMessage(tab.id, { ...m, id }).catch(() => {});
  try {
    const print = await capturar(tab.windowId);
    enviar({ tipo: "capturado" });
    const bitmap = await createImageBitmap(await (await fetch(print)).blob());
    const W = bitmap.width, H = bitmap.height;
    const tela = new OffscreenCanvas(W, H).getContext("2d", { willReadFrequently: true });
    tela.drawImage(bitmap, 0, 0);
    const pixels = tela.getImageData(0, 0, W, H);

    const coords = cfg.def.coords || "xy";
    const prompt = montarPrompt(cfg, coords);
    const assinatura = `${cfg.provedor}|${cfg.modelo}|${hashTexto(prompt)}`;
    const partes = pedacos({ x: area.x * W, y: area.y * H, w: area.w * W, h: area.h * H });

    const analises = new Map();
    const processar = (bs, q) => paraTela(bs, { x: q.x / W, y: q.y / H, w: q.w / W, h: q.h / H }).flatMap((b) => {
      const px = { l: b.l * W, t: b.t * H, r: b.r * W, b: b.b * H };
      const cx = (px.l + px.r) / 2, cy = (px.t + px.b) / 2;
      if (cx < q.dono.x0 || cx > q.dono.x1 || cy < q.dono.y0 || cy > q.dono.y1) return [];
      const chave = `${id}:${Math.round(px.l)},${Math.round(px.t)},${Math.round(px.r)},${Math.round(px.b)}`;
      let a = analises.get(chave);
      if (!a) analises.set(chave, (a = analisarBalao(pixels, px)));
      const norm = (c) => ({ l: c.l / W, t: c.t / H, r: c.r / W, b: c.b / H });
      return [{ chave, texto: b.texto, fundo: a.fundo, claro: a.claro, uniforme: a.uniforme, cobre: norm(a.cobre), area: norm(a.area) }];
    });

    const listas = partes.map(() => []);
    let prontos = 0, agendado = null;
    const atualizar = (fim) => enviar({ tipo: "baloes", fim, prontos, total: partes.length, lista: listas.flat() });
    const agendar = () => { agendado ??= setTimeout(() => { agendado = null; atualizar(false); }, 50); };

    const limite = limitador(4);
    const resultados = await Promise.allSettled(partes.map((q, i) => limite(async () => {
      if (controle.signal.aborted) return;
      const { hash, desvio } = amostrar(pixels, q);
      if (desvio >= 4) { // pedaço liso (fundo branco, espaço entre páginas) não tem o que traduzir
        const chaveCache = `c:${assinatura}:${hash}`;
        let bs = (await chrome.storage.session.get(chaveCache))[chaveCache];
        if (!bs) {
          const recorte = await recortar(bitmap, q);
          const resposta = await chamar(cfg, recorte, prompt, (acum) => {
            listas[i] = processar(parciais(acum, coords), q);
            agendar();
          }, controle.signal);
          bs = interpretar(resposta, coords);
          chrome.storage.session.set({ [chaveCache]: bs, ultimaResposta: resposta.slice(0, 4000) }).catch(() => {
            chrome.storage.session.clear(); // cota cheia: recomeça o cache
          });
        }
        listas[i] = processar(bs, q);
      }
      prontos++;
      agendar();
    })));
    clearTimeout(agendado);
    if (controle.signal.aborted) return;
    const falha = resultados.find((r) => r.status === "rejected");
    if (falha && listas.every((l) => !l.length)) throw falha.reason;
    atualizar(true);
  } catch (e) {
    if (e.name !== "AbortError") enviar({ tipo: "aviso", texto: e.message, erro: true });
  } finally {
    if (controles.get(tab.id) === controle) controles.delete(tab.id);
  }
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
