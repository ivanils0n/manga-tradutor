const chave = document.getElementById("chave");
const modelo = document.getElementById("modelo");
const ok = document.getElementById("ok");

chrome.storage.local.get(["chave", "modelo"]).then((p) => {
  chave.value = p.chave || "";
  modelo.value = p.modelo || "deepseek-flash";
});

document.getElementById("olho").onclick = () => {
  chave.type = chave.type === "password" ? "text" : "password";
};

document.getElementById("salvar").onclick = async () => {
  await chrome.storage.local.set({ chave: chave.value.trim(), modelo: modelo.value.trim() || "deepseek-flash" });
  ok.style.opacity = 1;
  setTimeout(() => (ok.style.opacity = 0), 2000);
};
