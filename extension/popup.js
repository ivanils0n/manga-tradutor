chrome.storage.local.get("chave").then(({ chave }) => {
  if (!chave) document.getElementById("semChave").style.display = "block";
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
for (const a of document.querySelectorAll(".config")) {
  a.onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
}
