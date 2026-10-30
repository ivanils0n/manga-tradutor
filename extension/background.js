import { traduzir, paraTela } from "./tradutor.js";

chrome.commands.onCommand.addListener((cmd, tab) => executar(cmd, tab));
chrome.runtime.onMessage.addListener(({ acao }) => {
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab && executar(acao, tab));
});

async function executar(acao, tab) {
  const { chave, modelo } = await chrome.storage.local.get(["chave", "modelo"]);
  if (!chave) return chrome.runtime.openOptionsPage();

  const alvo = { tabId: tab.id };
  const rodar = (func, ...args) =>
    chrome.scripting.executeScript({ target: alvo, func, args }).then((r) => r?.[0]?.result).catch(() => null);
  // Falha em páginas internas (chrome://, loja); aí não há o que traduzir.
  try { await chrome.scripting.insertCSS({ target: alvo, files: ["pagina.css"] }); } catch { return; }

  let area = null;
  if (acao === "recortar") {
    area = await rodar(selecionarArea);
    if (!area) return; // Esc ou seleção pequena demais
  }
  try {
    let imagem = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 90 });
    await rodar(mostrarAviso, "Traduzindo…");
    if (area) imagem = await recortarImagem(imagem, area);
    let baloes = await traduzir(imagem, chave, modelo || "deepseek-flash");
    if (area) baloes = paraTela(baloes, area);
    await rodar(desenhar, baloes);
  } catch (e) {
    await rodar(mostrarAviso, e.message, "erro");
  }
}

/** Corta o print (data URL) na área {x,y,w,h} normalizada 0..1 e devolve outro data URL JPEG. */
async function recortarImagem(dataUrl, a) {
  const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const sx = Math.round(a.x * img.width), sy = Math.round(a.y * img.height);
  const sw = Math.max(1, Math.round(a.w * img.width)), sh = Math.max(1, Math.round(a.h * img.height));
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => falha(r.error);
    r.readAsDataURL(blob);
  });
}

// As funções abaixo rodam dentro da página (precisam ser autocontidas).

/** Deixa o usuário arrastar um retângulo; devolve {x,y,w,h} normalizado na tela, ou null. */
function selecionarArea() {
  document.querySelector(".mt-capa")?.remove();
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
    const tecla = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); terminar(null); } };
    addEventListener("keydown", tecla, true);
    const terminar = (resultado) => {
      capa.remove();
      removeEventListener("keydown", tecla, true);
      // espera a página repintar sem a capa antes do print
      requestAnimationFrame(() => requestAnimationFrame(() => fim(resultado)));
    };

    capa.onmousedown = (e) => {
      if (e.button !== 0) return terminar(null);
      x0 = e.clientX; y0 = e.clientY;
      capa.classList.add("mt-arrastando");
      capa.querySelector(".mt-dica").remove();
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

function mostrarAviso(texto, tipo) {
  document.querySelector(".mt-aviso")?.remove();
  const d = document.createElement("div");
  d.className = "mt-aviso" + (tipo === "erro" ? " mt-erro" : "");
  d.setAttribute("role", "status");
  if (!tipo) d.appendChild(Object.assign(document.createElement("span"), { className: "mt-roda" }));
  d.appendChild(document.createTextNode(texto));
  document.body.appendChild(d);
  if (tipo) setTimeout(() => d.remove(), tipo === "erro" ? 6000 : 2500);
}

function desenhar(baloes) {
  document.querySelector(".mt-aviso")?.remove();
  document.querySelectorAll(".mt-balao").forEach((e) => e.remove());
  if (!baloes.length) {
    const d = document.createElement("div");
    d.className = "mt-aviso";
    d.textContent = "Nenhum texto encontrado";
    document.body.appendChild(d);
    return setTimeout(() => d.remove(), 2500);
  }
  // Absoluto na página (não fixed) para acompanhar a rolagem.
  const W = innerWidth, H = innerHeight, sx = scrollX, sy = scrollY;
  baloes.forEach((b, i) => {
    const d = document.createElement("div");
    d.className = "mt-balao";
    d.textContent = b.texto;
    d.title = "Clique para fechar";
    const w = (b.r - b.l) * W, h = (b.b - b.t) * H;
    // fonte que cabe na caixa: área por caractere, limitada a 11–20px
    const fonte = Math.max(11, Math.min(20, Math.sqrt((w * h) / b.texto.length) * 0.85));
    Object.assign(d.style, {
      left: b.l * W + sx + "px", top: b.t * H + sy + "px", width: w + "px", minHeight: h + "px",
      fontSize: fonte + "px", animationDelay: i * 30 + "ms",
    });
    d.onclick = () => d.remove();
    document.body.appendChild(d);
  });
  addEventListener("keydown", function fechar(e) {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".mt-balao").forEach((x) => x.remove());
    removeEventListener("keydown", fechar);
  });
}
