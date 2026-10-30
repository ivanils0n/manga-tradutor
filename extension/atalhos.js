// Usado pela página (content script), pelo popup e pelas configurações.
const ATALHOS_PADRAO = { pagina: ["T"], recortar: ["R"], alternar: ["O"] };
const MODIFICADORES = ["Ctrl", "Alt", "Shift", "Meta"];
const BOTOES_MOUSE = { 1: "Botão do meio", 3: "Mouse voltar", 4: "Mouse avançar" };

/** Nome estável da tecla, independente do layout (Shift+1 continua "1"). */
function nomeTecla(e) {
  const mod = { Control: "Ctrl", Alt: "Alt", AltGraph: "Alt", Shift: "Shift", Meta: "Meta", OS: "Meta" }[e.key];
  if (mod) return mod;
  const c = e.code || "";
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (c.startsWith("Numpad")) return "Num" + c.slice(6);
  return c || e.key;
}

/** Modificadores primeiro, depois as outras teclas na ordem em que foram apertadas. */
function ordenarCombo(teclas) {
  const lista = [...new Set(teclas)];
  return [...MODIFICADORES.filter((m) => lista.includes(m)), ...lista.filter((t) => !MODIFICADORES.includes(t))];
}

function mesmoCombo(a, b) {
  return a.length === b.length && a.every((t) => b.includes(t));
}

function textoCombo(combo) {
  return combo?.length ? combo.join(" + ") : "sem atalho";
}

async function lerAtalhos() {
  const { atalhos } = await chrome.storage.local.get("atalhos");
  return { ...ATALHOS_PADRAO, ...atalhos };
}
