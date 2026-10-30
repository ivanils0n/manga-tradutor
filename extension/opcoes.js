const chave = document.getElementById("chave");
const modelo = document.getElementById("modelo");

chrome.storage.local.get(["chave", "modelo"]).then((p) => {
  chave.value = p.chave || "";
  modelo.value = p.modelo || "deepseek-flash";
});

document.getElementById("olho").onclick = () => {
  chave.type = chave.type === "password" ? "text" : "password";
};

document.getElementById("salvar").onclick = async () => {
  await chrome.storage.local.set({ chave: chave.value.trim(), modelo: modelo.value.trim() || "deepseek-flash" });
  const ok = document.getElementById("ok");
  ok.style.opacity = 1;
  setTimeout(() => (ok.style.opacity = 0), 2000);
};

// ---- atalhos ----
let atalhos = {};
const gravadores = document.querySelectorAll(".gravador");

function mostrar(el, combo, gravando) {
  el.replaceChildren();
  if (!combo.length) {
    el.append(gravando ? "Aperte as teclas…" : "Sem atalho (clique para gravar)");
    return;
  }
  combo.forEach((t, i) => {
    if (i) el.append(Object.assign(document.createElement("span"), { className: "mais", textContent: "+" }));
    el.append(Object.assign(document.createElement("kbd"), { textContent: t }));
  });
}

function avisar(acao, texto) {
  document.querySelector(`[data-aviso="${acao}"]`).textContent = texto;
}

async function salvar(acao, combo) {
  atalhos[acao] = combo;
  await chrome.storage.local.set({ atalhos });
}

lerAtalhos().then((a) => {
  atalhos = a;
  for (const g of gravadores) mostrar(g, atalhos[g.dataset.acao], false);
});

for (const g of gravadores) {
  const acao = g.dataset.acao;
  let apertadas = null; // teclas seguradas agora; null = não está gravando
  let combo = [];

  const parar = (salvarCombo) => {
    if (!apertadas) return;
    apertadas = null;
    g.classList.remove("gravando");
    if (!salvarCombo || !combo.length) return mostrar(g, atalhos[acao], false);
    const outro = Object.entries(atalhos).find(([a, c]) => a !== acao && c.length && mesmoCombo(c, combo));
    if (outro) {
      avisar(acao, `${textoCombo(combo)} já é usado pelo outro atalho.`);
      return mostrar(g, atalhos[acao], false);
    }
    if (combo.length === 1 && !/^F\d+$/.test(combo[0])) {
      avisar(acao, "Tecla sozinha não dispara enquanto você digita em campos de texto.");
    }
    salvar(acao, combo);
    mostrar(g, combo, false);
  };

  g.onclick = () => {
    if (apertadas) return;
    apertadas = new Set();
    combo = [];
    avisar(acao, "");
    g.classList.add("gravando");
    mostrar(g, [], true);
  };
  g.onblur = () => parar(false);
  g.onkeydown = (e) => {
    if (!apertadas) return;
    e.preventDefault();
    if (e.repeat) return;
    const t = nomeTecla(e);
    if (t === "Escape" && !apertadas.size) return parar(false);
    apertadas.add(t);
    combo = ordenarCombo([...combo, t]);
    mostrar(g, combo, true);
  };
  g.onkeyup = (e) => {
    if (!apertadas) return;
    e.preventDefault();
    apertadas.delete(nomeTecla(e));
    if (!apertadas.size) parar(true); // soltou tudo: grava a combinação
  };
}

for (const b of document.querySelectorAll(".limpar")) {
  b.onclick = () => {
    const acao = b.dataset.acao;
    salvar(acao, []);
    avisar(acao, "");
    mostrar(document.querySelector(`.gravador[data-acao="${acao}"]`), [], false);
  };
}
