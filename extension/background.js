import { traduzir } from "./tradutor.js";

chrome.action.onClicked.addListener(async (tab) => {
  const { chave, modelo } = await chrome.storage.local.get(["chave", "modelo"]);
  if (!chave) return chrome.runtime.openOptionsPage();

  const rodar = (func, ...args) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }).catch(() => {});

  await rodar(mostrarAviso, "Traduzindo…");
  try {
    const imagem = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 });
    const baloes = await traduzir(imagem, chave, modelo || "deepseek-flash");
    await rodar(desenhar, baloes);
  } catch (e) {
    await rodar(mostrarAviso, "Erro: " + e.message, 6000);
  }
});

// As funções abaixo rodam dentro da página (precisam ser autocontidas).

function mostrarAviso(texto, ms = 0) {
  document.getElementById("mt-aviso")?.remove();
  const d = document.createElement("div");
  d.id = "mt-aviso";
  d.textContent = texto;
  d.style.cssText =
    "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "background:#1e2130f2;color:#ededf3;padding:8px 16px;border-radius:999px;font:14px system-ui,sans-serif;";
  document.body.appendChild(d);
  if (ms) setTimeout(() => d.remove(), ms);
}

function desenhar(baloes) {
  document.getElementById("mt-aviso")?.remove();
  document.querySelectorAll(".mt-balao").forEach((e) => e.remove());
  if (!baloes.length) {
    const d = document.createElement("div");
    d.id = "mt-aviso";
    d.textContent = "Nenhum texto encontrado";
    d.style.cssText =
      "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
      "background:#1e2130f2;color:#ededf3;padding:8px 16px;border-radius:999px;font:14px system-ui,sans-serif;";
    document.body.appendChild(d);
    return setTimeout(() => d.remove(), 3000);
  }
  // Absoluto na página (não fixed) para acompanhar a rolagem.
  const W = innerWidth, H = innerHeight, sx = scrollX, sy = scrollY;
  for (const b of baloes) {
    const d = document.createElement("div");
    d.className = "mt-balao";
    d.textContent = b.texto;
    d.title = "Clique para fechar";
    const w = (b.r - b.l) * W, h = (b.b - b.t) * H;
    d.style.cssText =
      `position:absolute;left:${b.l * W + sx}px;top:${b.t * H + sy}px;width:${w}px;min-height:${h}px;` +
      "z-index:2147483646;box-sizing:border-box;background:#fff;color:#111;border-radius:10px;" +
      "display:flex;align-items:center;justify-content:center;text-align:center;padding:4px;cursor:pointer;" +
      `font:600 ${Math.max(11, Math.min(18, w / 9))}px/1.2 system-ui,sans-serif;box-shadow:0 1px 4px #0004;`;
    d.onclick = () => d.remove();
    document.body.appendChild(d);
  }
  addEventListener("keydown", function fechar(e) {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".mt-balao").forEach((x) => x.remove());
    removeEventListener("keydown", fechar);
  });
}
