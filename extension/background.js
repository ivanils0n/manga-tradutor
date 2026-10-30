import { traduzir, paraTela, pedacos } from "./tradutor.js";

chrome.runtime.onMessage.addListener(({ acao }, remetente) => {
  if (!acao) return;
  if (remetente.tab) return void executar(acao, remetente.tab);
  // veio do popup
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab && executar(acao, tab));
});

/** Manda mensagem para a página; se ela foi aberta antes da extensão, injeta o script e tenta de novo. */
async function falar(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["pagina.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["atalhos.js", "content.js"] });
    return chrome.tabs.sendMessage(tabId, msg);
  }
}

let ultima = 0;

async function executar(acao, tab) {
  const id = ++ultima;
  const { chave, modelo } = await chrome.storage.local.get(["chave", "modelo"]);
  if (!chave) return chrome.runtime.openOptionsPage();

  let area;
  try { area = await falar(tab.id, { tipo: "preparar", acao, id }); } catch { return; } // página interna do navegador
  if (!area) return; // recorte cancelado

  const enviar = (m) => chrome.tabs.sendMessage(tab.id, { ...m, id }).catch(() => {});
  try {
    const print = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 95 });
    enviar({ tipo: "aviso", texto: "Traduzindo…" });
    const img = await createImageBitmap(await (await fetch(print)).blob());
    const W = img.width, H = img.height;
    // pedaços de até 1000px: a API reduz cada imagem para ~800px, então a tela inteira de uma vez perde o texto
    const partes = pedacos({ x: area.x * W, y: area.y * H, w: area.w * W, h: area.h * H });

    const listas = partes.map(() => []);
    let agendado = null;
    const atualizar = (fim) => enviar({
      tipo: "baloes", fim,
      lista: listas.flatMap((l, i) => l.map((b, j) => ({ ...b, chave: `${i}-${j}` }))),
    });
    const agendar = () => {
      agendado ??= setTimeout(() => { agendado = null; atualizar(false); }, 60);
    };

    // todos os pedaços em paralelo, cada um em streaming
    const resultados = await Promise.allSettled(partes.map(async (q, i) => {
      const doPedaco = (bs) => paraTela(bs, { x: q.x / W, y: q.y / H, w: q.w / W, h: q.h / H }).filter((b) => {
        const cx = ((b.l + b.r) / 2) * W, cy = ((b.t + b.b) / 2) * H;
        return cx >= q.dono.x0 && cx <= q.dono.x1 && cy >= q.dono.y0 && cy <= q.dono.y1;
      });
      const imagem = await recortar(img, q);
      const final = await traduzir(imagem, chave, modelo || "deepseek-flash", (bs) => {
        listas[i] = doPedaco(bs);
        agendar();
      });
      listas[i] = doPedaco(final);
    }));
    clearTimeout(agendado);
    const falha = resultados.find((r) => r.status === "rejected");
    if (falha && listas.every((l) => !l.length)) throw falha.reason;
    atualizar(true);
  } catch (e) {
    enviar({ tipo: "aviso", texto: e.message, erro: true });
  }
}

/** Corta o pedaço {x,y,w,h} (pixels) do print e devolve um data URL JPEG. */
async function recortar(img, q) {
  const w = Math.max(1, Math.round(q.w)), h = Math.max(1, Math.round(q.h));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(img, q.x, q.y, w, h, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => falha(r.error);
    r.readAsDataURL(blob);
  });
}
