import("./config.js").then(async ({ lerConfig, faltaConfig, versaoMaior }) => {
  const cfg = await lerConfig();
  const falta = faltaConfig(cfg);
  const el = document.getElementById("provedor");
  el.classList.toggle("falta", !!falta);
  el.querySelector("span").textContent = falta ? `${falta} — configure` : `${cfg.def.nome} · ${cfg.modelo}`;
  if (falta) el.style.cursor = "pointer", (el.onclick = () => chrome.runtime.openOptionsPage());
  avisarVersaoNova(versaoMaior);
});

// uso de hoje, numa linha
chrome.storage.local.get("uso").then(({ uso }) => {
  const hoje = uso?.dia === new Date().toLocaleDateString("sv") ? uso.hoje : null;
  if (hoje && (hoje.chamadas || hoje.cache)) {
    document.getElementById("usoHoje").textContent = `Hoje: ${hoje.chamadas || 0} chamada(s) à IA · ${hoje.cache || 0} página(s) do cache`;
  }
});

/** A extensão é instalada à mão: avisa quando sai versão nova no GitHub (confere no máximo a cada 6 h). */
async function avisarVersaoNova(versaoMaior) {
  let { atualizacao: info = {} } = await chrome.storage.local.get("atualizacao");
  if (!info.checado || Date.now() - info.checado > 6 * 3600e3) {
    try {
      const r = await fetch("https://api.github.com/repos/ivanils0n/manga-tradutor/releases/tags/extensao");
      const j = r.ok ? await r.json() : {};
      const versao = (j.body || "").match(/versao=([\d.]+)/)?.[1] || (j.name || "").match(/v([\d.]+)/)?.[1] || "";
      info = { versao, url: j.html_url || info.url, checado: Date.now() };
      chrome.storage.local.set({ atualizacao: info });
    } catch { /* sem internet ou GitHub fora: tenta de novo na próxima */ }
  }
  if (info.versao && versaoMaior(info.versao, chrome.runtime.getManifest().version)) {
    const a = document.getElementById("novidade");
    a.textContent = `Versão ${info.versao} disponível — baixar`;
    a.href = info.url || "https://github.com/ivanils0n/manga-tradutor/releases";
    a.hidden = false;
  }
}

lerAtalhos().then((a) => {
  for (const [acao, combo] of Object.entries(a)) {
    const el = document.getElementById("atalho-" + acao);
    if (el) el.textContent = textoCombo(combo);
  }
});

for (const b of document.querySelectorAll("[data-acao]")) {
  b.onclick = async () => {
    await chrome.runtime.sendMessage({ acao: b.dataset.acao });
    window.close();
  };
}
document.getElementById("alternar").onclick = async () => {
  await chrome.runtime.sendMessage({ acao: "alternar" });
  window.close();
};
document.getElementById("config").onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};

// opções que valem por site (ao rolar, inglês, atalhos de uma tecla)
chrome.tabs?.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  const chaves = [...document.querySelectorAll("[data-site]")];
  let site = "";
  try { site = new URL(tab.url).hostname; } catch {}
  if (!site || !/^https?:/.test(tab.url)) {
    for (const c of chaves) c.disabled = true;
    document.getElementById("site").textContent = "indisponível nesta página";
    return;
  }
  document.getElementById("site").textContent = site;
  const salvo = await chrome.storage.local.get(chaves.map((c) => c.dataset.site));
  for (const c of chaves) {
    const nome = c.dataset.site, invertido = c.hasAttribute("data-invertido"); // guardado como "desligado neste site"
    c.checked = !!salvo[nome]?.[site] !== invertido;
    c.onchange = async () => {
      const { [nome]: lista = {} } = await chrome.storage.local.get(nome);
      if (c.checked !== invertido) lista[site] = true; else delete lista[site];
      await chrome.storage.local.set({ [nome]: lista });
    };
  }
});
