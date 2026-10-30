import { PROVEDORES, IDIOMAS, PADRAO, lerConfig } from "./config.js";

const $ = (id) => document.getElementById(id);
let cfg = await lerConfig();

// ---------- salvar sozinho ----------
let timerSalvo = 0;
async function salvar(dados) {
  await chrome.storage.local.set(dados);
  $("salvo").style.opacity = 1;
  clearTimeout(timerSalvo);
  timerSalvo = setTimeout(() => ($("salvo").style.opacity = 0), 1400);
}
const atrasar = (f, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

// ---------- 01 provedor ----------
$("provedores").innerHTML = Object.entries(PROVEDORES).map(([id, p]) =>
  `<label><input type="radio" name="provedor" value="${id}">${p.nome}<small>${
    p.semChave ? "Grátis, roda no seu PC" : p.editarUrl ? "Qualquer API no padrão OpenAI" : p.modelo}</small></label>`).join("");

function mostrarProvedor() {
  const p = PROVEDORES[cfg.provedor];
  document.querySelector(`input[name=provedor][value="${cfg.provedor}"]`).checked = true;
  $("chave").value = cfg.chaves[cfg.provedor] || "";
  $("modelo").value = cfg.modelos[cfg.provedor] || p.modelo;
  $("modelo").placeholder = p.modelo || "nome do modelo";
  $("sugestoes").innerHTML = (p.sugestoes || []).map((s) => `<option value="${s}">`).join("");
  $("url").value = cfg.urls[cfg.provedor] || p.url;
  $("campo-chave").style.display = p.semChave ? "none" : "";
  $("campo-url").style.display = p.editarUrl ? "" : "none";
  $("ajuda-chave").innerHTML = p.site ? `Pegue a sua em <a href="${p.site}" target="_blank" rel="noopener">${new URL(p.site).host}</a>. Fica salva só neste navegador.` : "Fica salva só neste navegador.";
  $("ajuda-url").textContent = cfg.provedor === "ollama"
    ? "Inicie o Ollama com OLLAMA_ORIGINS=chrome-extension://* para aceitar a extensão."
    : "Termina em /v1 na maioria dos serviços.";
  $("teste").className = "teste";
}
for (const r of document.querySelectorAll("input[name=provedor]")) {
  r.onchange = async () => {
    cfg.provedor = r.value;
    await salvar({ provedor: r.value });
    mostrarProvedor();
  };
}
const guardarProvedor = atrasar(async () => {
  cfg.chaves = { ...cfg.chaves, [cfg.provedor]: $("chave").value.trim() };
  cfg.modelos = { ...cfg.modelos, [cfg.provedor]: $("modelo").value.trim() };
  cfg.urls = { ...cfg.urls, [cfg.provedor]: $("url").value.trim() };
  await salvar({ chaves: cfg.chaves, modelos: cfg.modelos, urls: cfg.urls });
});
for (const id of ["chave", "modelo", "url"]) $(id).oninput = guardarProvedor;
mostrarProvedor();

$("testar").onclick = async () => {
  const t = $("teste");
  t.className = "teste ok";
  t.textContent = "Mandando um balão de teste…";
  $("testar").disabled = true;
  await new Promise((ok) => setTimeout(ok, 400)); // deixa o último campo digitado ser salvo
  const r = await chrome.runtime.sendMessage({ tipo: "testar" }).catch((e) => ({ erro: e.message }));
  $("testar").disabled = false;
  if (r?.erro) {
    t.className = "teste erro";
    t.innerHTML = "<b>Não funcionou</b>";
    t.append(r.erro);
    return;
  }
  const textos = r.baloes.map((b) => `“${b.texto}”`).join(" ");
  t.className = r.baloes.length ? "teste ok" : "teste erro";
  t.innerHTML = r.baloes.length ? `<b>Funcionando · ${(r.ms / 1000).toFixed(1)} s</b>` : "<b>A IA respondeu, mas não achou o balão</b>";
  t.append(r.baloes.length ? textos : "Esse modelo talvez não leia imagens. Resposta: " + r.bruto.slice(0, 300));
};

// ---------- 02 tradução ----------
$("idioma").innerHTML = Object.entries(IDIOMAS).map(([v, n]) => `<option value="${v}">${n}</option>`).join("");
$("idioma").value = cfg.idioma;
$("idioma").onchange = () => salvar({ idioma: $("idioma").value });
$("adiantar").value = cfg.adiantar;
$("adiantar").onchange = () => salvar({ adiantar: $("adiantar").value });
for (const id of ["honorificos", "onomatopeias", "maiusculas"]) {
  $(id).checked = cfg[id] ?? PADRAO[id];
  $(id).onchange = () => salvar({ [id]: $(id).checked });
}
for (const r of document.querySelectorAll("input[name=fonte]")) {
  r.checked = r.value === cfg.fonte;
  r.onchange = () => salvar({ fonte: r.value });
}
$("glossario").value = cfg.glossario || "";
$("glossario").oninput = atrasar(() => salvar({ glossario: $("glossario").value }), 600);

// ---------- 03 atalhos ----------
let atalhos = await lerAtalhos();
const gravadores = [...document.querySelectorAll(".gravador")];

function mostrarAtalho(el, combo, gravando) {
  el.replaceChildren();
  if (!combo.length) {
    el.append(gravando ? "Aperte a tecla…" : "Sem atalho — clique para gravar");
    return;
  }
  combo.forEach((t, i) => {
    if (i) el.append(Object.assign(document.createElement("span"), { className: "mais", textContent: "+" }));
    el.append(Object.assign(document.createElement("kbd"), { textContent: t }));
  });
}
const avisar = (acao, texto) => (document.querySelector(`[data-aviso="${acao}"]`).textContent = texto);

async function gravar(acao, combo) {
  const outro = Object.entries(atalhos).find(([a, c]) => a !== acao && c?.length && mesmoCombo(c, combo));
  if (outro) {
    avisar(acao, `${textoCombo(combo)} já está em uso em outro atalho.`);
    return false;
  }
  atalhos = { ...atalhos, [acao]: combo };
  await salvar({ atalhos });
  return true;
}

for (const g of gravadores) {
  const acao = g.dataset.acao;
  let apertadas = null; // teclas seguradas agora; null = não está gravando
  let combo = [];
  mostrarAtalho(g, atalhos[acao], false);

  const parar = async (guardar) => {
    if (!apertadas) return;
    apertadas = null;
    g.classList.remove("gravando");
    if (guardar && combo.length && (await gravar(acao, combo))) return mostrarAtalho(g, combo, false);
    mostrarAtalho(g, atalhos[acao], false);
  };
  g.onclick = () => {
    if (apertadas) return;
    apertadas = new Set();
    combo = [];
    avisar(acao, "");
    g.classList.add("gravando");
    mostrarAtalho(g, [], true);
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
    mostrarAtalho(g, combo, true);
  };
  g.onkeyup = (e) => {
    if (!apertadas) return;
    e.preventDefault();
    apertadas.delete(nomeTecla(e));
    if (!apertadas.size) parar(true); // soltou tudo: grava (uma tecla sozinha já vale)
  };
  g.onmousedown = (e) => {
    const b = BOTOES_MOUSE[e.button];
    if (!apertadas || !b) return;
    e.preventDefault();
    combo = ordenarCombo([...[...apertadas].filter((t) => MODIFICADORES.includes(t)), b]);
    parar(true);
  };
  // não deixa o botão "voltar" do mouse sair da página enquanto grava
  g.onmouseup = g.onauxclick = (e) => { if (BOTOES_MOUSE[e.button]) e.preventDefault(); };
}
for (const b of document.querySelectorAll("[data-limpar]")) {
  b.onclick = async () => {
    const acao = b.dataset.limpar;
    atalhos = { ...atalhos, [acao]: [] };
    await salvar({ atalhos });
    avisar(acao, "");
    mostrarAtalho(document.querySelector(`.gravador[data-acao="${acao}"]`), [], false);
  };
}

// ---------- 04 diagnóstico ----------
chrome.storage.session.get("ultimaResposta").then(({ ultimaResposta }) => {
  if (ultimaResposta) $("ultima").textContent = ultimaResposta;
});
$("limparCache").onclick = async () => {
  await chrome.runtime.sendMessage({ tipo: "limparCache" });
  await chrome.storage.session.clear();
  $("cacheOk").textContent = "Pronto: as próximas traduções serão feitas de novo.";
};
