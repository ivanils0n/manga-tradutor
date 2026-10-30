chrome.storage.local.get("chave").then(({ chave }) => {
  if (!chave) document.getElementById("semChave").style.display = "block";
});

// Mostra os atalhos reais (o usuário pode ter trocado).
chrome.commands.getAll().then((cmds) => {
  for (const c of cmds) {
    const el = document.getElementById("atalho-" + c.name);
    if (el) el.textContent = c.shortcut || "sem atalho";
  }
});

for (const b of document.querySelectorAll("[data-acao]")) {
  b.onclick = async () => {
    await chrome.runtime.sendMessage({ acao: b.dataset.acao });
    window.close();
  };
}
for (const a of document.querySelectorAll(".config")) {
  a.onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
}
document.getElementById("atalhos").onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
};
