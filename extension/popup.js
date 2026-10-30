import("./config.js").then(async ({ lerConfig, faltaConfig }) => {
  const cfg = await lerConfig();
  const falta = faltaConfig(cfg);
  const el = document.getElementById("provedor");
  el.classList.toggle("falta", !!falta);
  el.querySelector("span").textContent = falta ? `${falta} — configure` : `${cfg.def.nome} · ${cfg.modelo}`;
  if (falta) el.style.cursor = "pointer", (el.onclick = () => chrome.runtime.openOptionsPage());
});

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

// "Traduzir ao rolar" vale por site
const auto = document.getElementById("auto");
chrome.tabs?.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  let site = "";
  try { site = new URL(tab.url).hostname; } catch {}
  if (!site || !/^https?:/.test(tab.url)) {
    auto.disabled = true;
    document.getElementById("site").textContent = "indisponível nesta página";
    return;
  }
  document.getElementById("site").textContent = site;
  const { auto: lista = {} } = await chrome.storage.local.get("auto");
  auto.checked = !!lista[site];
  auto.onchange = async () => {
    const { auto: atual = {} } = await chrome.storage.local.get("auto");
    if (auto.checked) atual[site] = true; else delete atual[site];
    await chrome.storage.local.set({ auto: atual });
  };
});
