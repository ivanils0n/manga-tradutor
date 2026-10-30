const chave = document.getElementById("chave");
const modelo = document.getElementById("modelo");

chrome.storage.local.get(["chave", "modelo"]).then((p) => {
  chave.value = p.chave || "";
  modelo.value = p.modelo || "deepseek-flash";
});

document.getElementById("salvar").onclick = async () => {
  await chrome.storage.local.set({ chave: chave.value.trim(), modelo: modelo.value.trim() || "deepseek-flash" });
  document.getElementById("ok").textContent = "Salvo ✓";
};
