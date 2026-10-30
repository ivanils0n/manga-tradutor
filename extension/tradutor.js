// Lógica pura (sem APIs do navegador): prompt, leitura da resposta, pedaços da tela e análise do balão.

const LINGUA = {
  "pt-BR": "Brazilian Portuguese", "pt-PT": "European Portuguese", en: "English", es: "Spanish",
  fr: "French", it: "Italian", de: "German",
};

/** Glossário do usuário + o aprendido automaticamente para a obra, num texto curto para o prompt. */
function textoGlossario(o) {
  const pares = String(o.glossario || "")
    .split("\n").map((l) => l.split(/\s*(?:=|->|→)\s*/)).filter((p) => p.length === 2 && p[0] && p[1])
    .map(([a, b]) => [a.trim(), b.trim()]);
  const vistos = new Set(pares.map(([a]) => a.toLowerCase()));
  for (const [a, b] of o.glossarioAuto || []) if (!vistos.has(a.toLowerCase())) { vistos.add(a.toLowerCase()); pares.push([a, b]); }
  return pares.map(([a, b]) => `${a}→${b}`).join("; ").slice(0, 700);
}

const NOMES = ' Then "n": proper names (people, places, techniques) seen here that are NOT in the glossary,'
  + ' as [["original","translation"]], max 5; omit "n" if none.';

/**
 * Prompt curto (economiza tokens) e em inglês, que os modelos seguem melhor. Formato de saída em lista
 * compacta [caixa..., "texto"] para gastar o mínimo de tokens de resposta; a caixa vem antes do texto
 * para o balão ser coberto antes da tradução terminar de chegar.
 */
export function montarPrompt(o, coords = "xy") {
  const caixa = coords === "yx" ? "ymin,xmin,ymax,xmax" : "x1,y1,x2,y2";
  const glossario = textoGlossario(o);
  return [
    "Manga/manhwa/manhua image. Find every speech bubble, thought bubble, narration box and text block" +
      (o.onomatopeias ? ", including sound effects." : ". Skip sound effects.") +
      " Skip watermarks, page numbers and website UI.",
    "One entry per bubble/box: merge all its lines and columns into one text.",
    `Translate each into natural, fluent ${LINGUA[o.idioma] || o.idioma}, like a professional scanlation: ` +
      "keep each character's voice and the scene's context, keep it short to fit the bubble." +
      (o.honorificos ? " Keep Japanese honorifics (-san, -kun, -chan, -sama, senpai)." : ""),
    glossario && `Glossary, always use: ${glossario}`,
    `Reply ONLY with JSON in reading order: {"t":[[${caixa},"translation"]]}` + (o.aprender ? NOMES : ""),
    `${caixa}: tight box around the original text, integers 0-1000 relative to this image. No text: {"t":[]}`,
  ].filter(Boolean).join("\n");
}

/**
 * Prompt do modo inglês: o texto já foi lido no PC (Tesseract), então a IA recebe só texto, corrige os
 * erros de leitura e traduz. Sem imagem a chamada fica bem mais barata.
 * `unico`: uma chamada por balão. A IA vê todos os itens da página (contexto), mas escreve só o pedido no fim.
 */
export function montarPromptTexto(o, unico = false) {
  const glossario = textoGlossario(o);
  return [
    "English manga/manhwa text read by OCR, so it may have recognition errors (| for I, broken or missing letters)."
      + " Each numbered item is one speech bubble or caption, in reading order.",
    `Fix the OCR errors and translate ${unico ? "only the item asked at the end (the other items are context)" : "each item"}`
      + ` into natural, fluent ${LINGUA[o.idioma] || o.idioma}, like a professional`
      + " scanlation: keep each character's voice and the scene's context, keep it short to fit the bubble."
      + (o.honorificos ? " Keep Japanese honorifics (-san, -kun, -chan, -sama, senpai)." : ""),
    glossario && `Glossary, always use: ${glossario}`,
    (unico
      ? 'Reply ONLY with JSON: {"t":["translation"]}. Use "" if it is only OCR noise'
      : 'Reply ONLY with JSON: {"t":["translation 1","translation 2"]}, exactly one string per item, same order.'
        + ' Use "" for an item that is only OCR noise') + (o.onomatopeias ? "." : " or a sound effect.") + (o.aprender ? NOMES : ""),
  ].filter(Boolean).join("\n");
}

/** Os itens lidos pelo OCR, numerados, para a mensagem do modo inglês. */
export const itensTexto = (textos) => textos.map((t, i) => `${i + 1}. ${t}`).join("\n");

/** Resposta do modo inglês: uma tradução por item (as que faltarem viram ""). */
export function interpretarTexto(resposta, n) {
  let lista;
  try {
    const j = JSON.parse(resposta.slice(resposta.indexOf("{"), resposta.lastIndexOf("}") + 1));
    lista = Array.isArray(j.t) ? j.t : null;
  } catch { /* cortada no meio: usa o que deu para ler */ }
  lista ??= parciaisTexto(resposta);
  return Array.from({ length: n }, (_, i) => (typeof lista[i] === "string" ? lista[i].trim() : ""));
}

/** Traduções do modo inglês que já chegaram no streaming (a última pode estar pela metade). */
export function parciaisTexto(json) {
  const m = /"t"\s*:\s*\[/.exec(json);
  if (!m) return [];
  const saida = [];
  const re = /\s*,?\s*"((?:[^"\\]|\\.)*)("?)/y;
  re.lastIndex = m.index + m[0].length;
  for (let r; (r = re.exec(json));) {
    saida.push(texto(r[1]));
    if (!r[2]) break; // string ainda aberta
    if (/^\s*\]/.test(json.slice(re.lastIndex))) break;
  }
  return saida;
}

/** Nomes próprios novos que a IA listou em "n" (glossário automático). */
export function nomesDe(resposta) {
  try {
    const j = JSON.parse(resposta.slice(resposta.indexOf("{"), resposta.lastIndexOf("}") + 1));
    return (Array.isArray(j.n) ? j.n : []).flatMap((p) => (Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string"
      && p[0].trim() && p[1].trim() && p[0].length <= 40 && p[1].length <= 40 ? [[p[0].trim(), p[1].trim()]] : [])).slice(0, 5);
  } catch {
    return [];
  }
}

/** Junta nomes novos ao glossário automático da obra (sem repetir; guarda só os últimos `max`). */
export function juntarGlossario(atual = [], novos = [], max = 60) {
  const saida = atual.filter(([a]) => !novos.some(([b]) => b.toLowerCase() === a.toLowerCase()));
  return [...saida, ...novos].slice(-max);
}

/**
 * Identifica a obra pelo título da aba, tirando capítulo e nome do site:
 * "One Piece - Chapter 1100 - MangaDex" → "one piece". Sem título útil, vale o site inteiro.
 */
export function obraDoTitulo(titulo, site) {
  let t = String(titulo || "").toLowerCase()
    .replace(/\b(chapter|chap|ch|cap[ií]tulo|cap|episode|episódio|ep|vol(ume)?|page|página)\b\.?\s*[\d.]+.*$/i, "")
    .split(/\s[-|–—:]\s/)[0]
    .replace(/^(read|ler)\s+/, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
  // shortcut: título que começa pelo capítulo ("Chapter 3 - X") cai no site; dá para melhorar por site se precisar
  if (t.length < 2) t = "";
  return `${site}|${t}`.slice(0, 80);
}

/** Lê a resposta final. Aceita o formato compacto e variações ({caixa,texto}, {box_2d,text}…). */
export function interpretar(resposta, coords = "xy") {
  const i = resposta.search(/[[{]/);
  const f = Math.max(resposta.lastIndexOf("}"), resposta.lastIndexOf("]"));
  let j;
  try { j = JSON.parse(resposta.slice(i, f + 1)); } catch { return parciais(resposta, coords).filter((b) => b.texto); }
  const lista = Array.isArray(j) ? j : j.t ?? j.baloes ?? j.texts ?? Object.values(j).find(Array.isArray) ?? [];
  return (Array.isArray(lista) ? lista : []).flatMap((o) => {
    let c, texto;
    if (Array.isArray(o)) { c = o.slice(0, 4); texto = o[4]; } else if (o && typeof o === "object") {
      c = o.caixa ?? o.box_2d ?? o.box ?? o.bbox;
      texto = o.texto ?? o.translation ?? o.text ?? o.traducao;
    }
    const b = caixa(c, coords);
    texto = String(texto ?? "").trim();
    return b && texto ? [{ ...b, texto }] : [];
  });
}

/** Lê uma resposta ainda incompleta: todo balão cuja caixa já chegou, com o texto que houver até agora. */
export function parciais(json, coords = "xy") {
  const lista = [];
  // formato com objetos {"caixa":[...],"texto":"..."}
  if (/"(?:caixa|box_2d|box|bbox)"\s*:/.test(json)) {
    const reObj = /"(?:caixa|box_2d|box|bbox)"\s*:\s*\[([^\]]*)\](?:\s*,\s*"(?:texto|translation|text)"\s*:\s*"((?:[^"\\]|\\.)*))?/g;
    for (const m of json.matchAll(reObj)) {
      const b = caixa(m[1].split(","), coords);
      if (b) lista.push({ ...b, texto: texto(m[2]) });
    }
    return lista;
  }
  const n = "\\s*(-?\\d+(?:\\.\\d+)?)\\s*";
  const re = new RegExp(`\\[${n},${n},${n},${n}(?:,\\s*"((?:[^"\\\\]|\\\\.)*))?`, "g");
  for (const m of json.matchAll(re)) {
    // sem o 5º item ainda: só aceita se a lista de números já fechou ou começou o texto
    const depois = json.slice(m.index + m[0].length).trimStart();
    if (m[5] === undefined && !/^[,\]]/.test(depois)) continue;
    const b = caixa(m.slice(1, 5), coords);
    if (!b) continue;
    lista.push({ ...b, texto: texto(m[5]) });
  }
  return lista;
}

function texto(s) {
  if (!s) return "";
  try { return JSON.parse(`"${s.replace(/\\(u[0-9a-fA-F]{0,3})?$/, "")}"`).trim(); } catch { return ""; }
}

function caixa(c, coords) {
  if (!Array.isArray(c) || c.length !== 4) return null;
  let n = c.map((v) => (String(v).trim() === "" ? NaN : Number(v)));
  if (n.some(Number.isNaN)) return null;
  if (coords === "yx") n = [n[1], n[0], n[3], n[2]];
  // alguns modelos respondem 0..1 em vez de 0..1000
  const escala = n.every((v) => v <= 1.5) ? 1 : 1000;
  const [x1, y1, x2, y2] = n.map((v) => Math.min(Math.max(v / escala, 0), 1));
  if (Math.abs(x2 - x1) < 0.003 || Math.abs(y2 - y1) < 0.003) return null;
  return { l: Math.min(x1, x2), t: Math.min(y1, y2), r: Math.max(x1, x2), b: Math.max(y1, y2) };
}

/** Converte balões normalizados no recorte r ({x,y,w,h} em 0..1 da tela) para normalizados na tela. */
export function paraTela(baloes, r) {
  return baloes.map((b) => ({
    ...b, l: r.x + b.l * r.w, t: r.y + b.t * r.h, r: r.x + b.r * r.w, b: r.y + b.b * r.h,
  }));
}

/**
 * Divide a área {x,y,w,h} (pixels) em pedaços de até `lado` px, com sobreposição. 1280 px cabe sem
 * redução nas APIs (a DeepSeek só reduz acima de ~1300×1300) e deixa a maioria das páginas num pedaço só.
 * Cada pedaço tem `dono`: a parte onde um balão centrado nele pertence a ele (evita duplicar
 * balões que caem na sobreposição).
 */
export function pedacos(a, lado = 1280, sobra = 0.2) {
  const eixo = (ini, tam) => {
    const n = Math.max(1, Math.ceil((tam - lado * sobra) / (lado * (1 - sobra))));
    const t = n === 1 ? tam : Math.min(tam, Math.ceil(tam / (n - (n - 1) * sobra)));
    const passo = n === 1 ? 0 : (tam - t) / (n - 1);
    return Array.from({ length: n }, (_, i) => {
      const exato = ini + i * passo;
      const meio = (t - passo) / 2; // metade da sobreposição
      return {
        p: Math.round(exato), t,
        d0: i === 0 ? ini : exato + meio,
        d1: i === n - 1 ? ini + tam : exato + t - meio,
      };
    });
  };
  const xs = eixo(a.x, a.w), ys = eixo(a.y, a.h);
  return ys.flatMap((y) => xs.map((x) => ({ x: x.p, y: y.p, w: x.t, h: y.t, dono: { x0: x.d0, x1: x.d1, y0: y.d0, y1: y.d1 } })));
}

/**
 * Faixas de um pedaço para traduzir em paralelo (uma chamada por faixa). Só corta nos vãos entre os
 * quadros: linhas inteiras de uma cor só, altas o bastante para não serem o espaço entre linhas de
 * texto. Assim nenhum balão fica partido e não precisa de sobreposição (não gasta imagem a mais).
 * Faixas de pelo menos `minimo` px, no máximo `max`; sem vão bom, volta o pedaço inteiro.
 */
export function faixasPorVaos(img, minimo = 360, max = 4) {
  const { data, width: w, height: h } = img;
  const n = Math.min(max, Math.floor(h / minimo));
  if (n < 2) return [[0, h]];
  const passo = Math.max(1, Math.floor(w / 200)); // ~200 amostras por linha
  const vaoMin = Math.max(16, Math.round(w * 0.02));
  const cortes = [];
  let ini = -1;
  for (let y = 0; y <= h; y++) {
    let lisa = y < h;
    for (let x = 0, lo = 255, hi = 0; lisa && x < w; x += passo) {
      const i = (y * w + x) * 4;
      const l = (data[i] * 2 + data[i + 1] * 5 + data[i + 2]) >> 3;
      if (l < lo) lo = l;
      if (l > hi) hi = l;
      if (hi - lo > 24) lisa = false;
    }
    if (lisa && ini < 0) ini = y;
    else if (!lisa && ini >= 0) {
      if (ini > 0 && y < h && y - ini >= vaoMin) cortes.push(Math.round((ini + y) / 2)); // margem de cima/baixo não conta
      ini = -1;
    }
  }
  const faixas = [];
  let y0 = 0;
  for (let k = n; k > 1; k--) { // o corte mais perto de dividir o que falta em k partes iguais
    const alvo = y0 + (h - y0) / k;
    let c = -1;
    for (const v of cortes) if (v - y0 >= minimo && h - v >= minimo && (c < 0 || Math.abs(v - alvo) < Math.abs(c - alvo))) c = v;
    if (c < 0) break;
    faixas.push([y0, c]);
    y0 = c;
  }
  faixas.push([y0, h]);
  return faixas;
}

/**
 * Impressão digital de um pedaço da imagem (para o cache) e quanto ele varia
 * (pedaço liso, sem nada desenhado, nem vai para a API).
 */
export function amostrar(img, q) {
  const { data, width } = img;
  let h = 0x811c9dc5, soma = 0, soma2 = 0, n = 0;
  for (let gy = 0; gy < 48; gy++) {
    const y = Math.floor(q.y + ((gy + 0.5) * q.h) / 48);
    for (let gx = 0; gx < 48; gx++) {
      const x = Math.floor(q.x + ((gx + 0.5) * q.w) / 48);
      const i = (y * width + x) * 4;
      const lum = (data[i] * 2 + data[i + 1] * 5 + data[i + 2]) >> 3;
      h = Math.imul(h ^ (lum >> 3), 0x01000193); // >>3 tolera ruído do JPEG
      soma += lum; soma2 += lum * lum; n++;
    }
  }
  const media = soma / n;
  return { hash: (h >>> 0).toString(36) + Math.round(q.w) + "x" + Math.round(q.h), desvio: Math.sqrt(soma2 / n - media * media) };
}

const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const lumi = (c) => (c[0] * 2 + c[1] * 5 + c[2]) / 8;

/**
 * Analisa o balão na imagem a partir da caixa do texto que a IA (ou o OCR) indicou, em pixels {l,t,r,b}:
 * - encaixe: a caixa da IA pode vir folgada, apertada ou deslocada. Procura em volta um anel de fundo
 *   liso (o interior do balão) e, dentro dele, onde há pixels que não são fundo: essa é a caixa real do texto;
 * - fundo: a cor desse anel (cobre o original sem "remendo" branco num balão creme);
 * - area: até onde o fundo continua liso, ou seja, o interior do balão. A tradução usa essa área,
 *   que costuma ser bem maior que o texto original (português ocupa mais espaço que japonês).
 * Sem anel liso (texto sobre o desenho) fica a caixa indicada e uniforme = false.
 */
export function analisarBalao(img, c) {
  const { data, width: W, height: H } = img;
  const cx = (x) => Math.min(W - 1, Math.max(0, Math.round(x))), cy = (y) => Math.min(H - 1, Math.max(0, Math.round(y)));
  const px = (x, y) => {
    const i = (cy(y) * W + cx(x)) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const dist = (p, f) => Math.abs(p[0] - f[0]) + Math.abs(p[1] - f[1]) + Math.abs(p[2] - f[2]);
  const menor = Math.max(1, Math.min(c.r - c.l, c.b - c.t));

  // anel em volta da caixa, afastado m px (m negativo = por dentro, para caixas folgadas demais)
  const anel = (m) => {
    const l = c.l - m, t = c.t - m, r = c.r + m, b = c.b + m;
    if (r - l < 8 || b - t < 8) return null;
    const amostras = [];
    const passo = Math.max(1, ((r - l) + (b - t)) / 80);
    for (let x = l; x <= r; x += passo) amostras.push(px(x, t), px(x, b));
    for (let y = t; y <= b; y += passo) amostras.push(px(l, y), px(r, y));
    const fundo = [0, 1, 2].map((k) => mediana(amostras.map((a) => a[k])));
    const uniforme = amostras.filter((a) => dist(a, fundo) < 60).length / amostras.length > 0.85;
    // plano: cor lisa de verdade (balão, caixa de narração); degradê e retícula passam no "uniforme" mas não aqui
    const plano = amostras.filter((a) => dist(a, fundo) < 24).length / amostras.length > 0.9;
    return { l, t, r, b, fundo, uniforme: uniforme && plano };
  };
  let liso = null, primeiro = null;
  for (const k of [0.06, 0.2, -0.15, 0.5, 1]) {
    const a = anel(Math.max(3, Math.round(menor * Math.abs(k))) * Math.sign(k));
    if (!a) continue;
    primeiro ??= a;
    if (a.uniforme) { liso = a; break; }
  }
  if (!liso) {
    const a = primeiro || { l: c.l, t: c.t, r: c.r, b: c.b, fundo: px((c.l + c.r) / 2, (c.t + c.b) / 2) };
    const caixa = { l: a.l, t: a.t, r: a.r, b: a.b };
    return { fundo: hex(a.fundo), claro: lumi(a.fundo) > 140, uniforme: false, cobre: caixa, area: { ...caixa } };
  }

  // dentro do anel liso: a caixa real do texto é onde há pixels bem diferentes do fundo
  const fundo = liso.fundo;
  const passo = (liso.r - liso.l) * (liso.b - liso.t) > 250000 ? 2 : 1;
  let tl = Infinity, tt = Infinity, tr = -Infinity, tb = -Infinity;
  for (let y = liso.t + 1; y < liso.b; y += passo) {
    let n = 0, x0 = Infinity, x1 = -Infinity;
    for (let x = liso.l + 1; x < liso.r; x += passo) {
      if (dist(px(x, y), fundo) >= 90) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    }
    if (n >= 2) { tl = Math.min(tl, x0); tr = Math.max(tr, x1 + passo); tt = Math.min(tt, y); tb = Math.max(tb, y + passo); }
  }
  const texto = tr > tl ? { l: tl, t: tt, r: tr, b: tb } : { l: c.l, t: c.t, r: c.r, b: c.b };
  const mg = Math.max(3, Math.round(Math.min(texto.r - texto.l, texto.b - texto.t) * 0.08));
  // margem em volta do texto (como a dilatação de máscara dos tradutores de mangá), sem passar do anel liso
  const cobre = {
    l: Math.max(liso.l, texto.l - mg), t: Math.max(liso.t, texto.t - mg),
    r: Math.min(liso.r, texto.r + mg), b: Math.min(liso.b, texto.b + mg),
  };

  const parecido = (p) => dist(p, fundo) < 60;
  const linhaLisa = (x0, y0, x1, y1) => {
    const n = Math.max(2, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 3));
    let ok = 0;
    for (let k = 0; k <= n; k++) if (parecido(px(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n))) ok++;
    return ok / (n + 1) >= 0.97;
  };
  const area = { ...cobre };
  const tw = texto.r - texto.l, th = texto.b - texto.t;
  // balão claro: a tradução pode ocupar o interior todo. Caixa escura (narração): só um pouco além do texto
  const claro = lumi(fundo) > 180;
  const maxX = claro ? Math.max(tw * 1.2, th * 0.8) + 24 : tw * 0.15 + 6, maxY = claro ? th * 0.45 + 12 : th * 0.15 + 4;
  // primeiro para os lados (a tradução é horizontal e mais longa), olhando só a faixa do meio:
  // num balão oval, as pontas de cima e de baixo fechariam cedo demais
  const m0 = area.t + (area.b - area.t) * 0.25, m1 = area.b - (area.b - area.t) * 0.25;
  for (let k = 0; k < maxX && area.l > 1 && linhaLisa(area.l - 2, m0, area.l - 2, m1); k += 2) area.l -= 2;
  for (let k = 0; k < maxX && area.r < W - 2 && linhaLisa(area.r + 2, m0, area.r + 2, m1); k += 2) area.r += 2;
  for (let k = 0; k < maxY && area.t > 1 && linhaLisa(area.l, area.t - 2, area.r, area.t - 2); k += 2) area.t -= 2;
  for (let k = 0; k < maxY && area.b < H - 2 && linhaLisa(area.l, area.b + 2, area.r, area.b + 2); k += 2) area.b += 2;
  return { fundo: hex(fundo), claro: lumi(fundo) > 140, uniforme: true, cobre, area };
}

/**
 * Reconstrói o fundo atrás de um texto escrito sobre o desenho: cada ponto da caixa vira a média das
 * bordas (esquerda, direita, cima, baixo), pesada pela distância. Resolve cor lisa e degradê; textura
 * fica suavizada. Devolve uma imagem pequena (até `maxLado` px) que a página estica por cima do texto.
 */
export function preencherBordas(img, c, maxLado = 128) {
  const { data, width: W, height: H } = img;
  const bw = Math.max(1, c.r - c.l), bh = Math.max(1, c.b - c.t);
  const s = Math.min(1, maxLado / Math.max(bw, bh));
  const w = Math.max(1, Math.round(bw * s)), h = Math.max(1, Math.round(bh * s));
  const media = (x, y) => { // 3×3 em volta: retícula e ruído do JPEG não viram listras
    const soma = [0, 0, 0];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = (Math.min(H - 1, Math.max(0, Math.round(y + dy))) * W + Math.min(W - 1, Math.max(0, Math.round(x + dx)))) * 4;
      soma[0] += data[i]; soma[1] += data[i + 1]; soma[2] += data[i + 2];
    }
    return soma.map((v) => v / 9);
  };
  const fora = 2; // um pouco para fora da caixa: longe do contorno serrilhado das letras
  const xs = Array.from({ length: w }, (_, i) => c.l + ((i + 0.5) / w) * bw);
  const ys = Array.from({ length: h }, (_, j) => c.t + ((j + 0.5) / h) * bh);
  const cima = xs.map((x) => media(x, c.t - fora)), baixo = xs.map((x) => media(x, c.b + fora));
  const esq = ys.map((y) => media(c.l - fora, y)), dir = ys.map((y) => media(c.r + fora, y));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = xs[i], y = ys[j];
      const wl = 1 / (x - c.l + fora), wr = 1 / (c.r - x + fora), wt = 1 / (y - c.t + fora), wb = 1 / (c.b - y + fora);
      const tot = wl + wr + wt + wb, k = (j * w + i) * 4;
      for (let ch = 0; ch < 3; ch++) out[k + ch] = (esq[j][ch] * wl + dir[j][ch] * wr + cima[i][ch] * wt + baixo[i][ch] * wb) / tot;
      out[k + 3] = 255;
    }
  }
  return { w, h, data: out };
}

// ---------- modo inglês: o que o Tesseract leu ----------

/** Linhas do TSV do Tesseract: texto, confiança média e caixa (pixels). Palavras sem confiança ficam de fora. */
export function linhasDoTsv(tsv) {
  const linhas = new Map();
  for (const l of String(tsv).split("\n")) {
    const c = l.split("\t");
    const texto = (c[11] || "").trim();
    const conf = Number(c[10]);
    if (c[0] !== "5" || !texto || !(conf >= 0)) continue;
    const [x, y, w, h] = c.slice(6, 10).map(Number);
    const k = c.slice(1, 5).join("-");
    const ln = linhas.get(k) || { palavras: [], l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
    ln.palavras.push({ texto, conf });
    ln.l = Math.min(ln.l, x); ln.t = Math.min(ln.t, y); ln.r = Math.max(ln.r, x + w); ln.b = Math.max(ln.b, y + h);
    linhas.set(k, ln);
  }
  return [...linhas.values()].map((ln) => ({
    ...ln, texto: ln.palavras.map((p) => p.texto).join(" "), conf: ln.palavras.reduce((a, p) => a + p.conf, 0) / ln.palavras.length,
  }));
}

/**
 * Junta as linhas de um mesmo balão: uma embaixo da outra, perto, e se cruzando na horizontal
 * (texto de balão é centralizado). Balões lado a lado ou mais afastados ficam separados.
 * Também tira o "ruído" típico do OCR em cima do desenho: pedacinhos curtos e com confiança baixa.
 */
export function agruparLinhas(linhas) {
  const letras = (t) => (t.match(/\p{L}/gu) || []).length;
  const pedacos = linhas.filter((ln) => !(ln.conf < 65 && letras(ln.texto) <= 4) && letras(ln.texto) > 0);
  // 1) no modo de texto esparso o Tesseract às vezes parte uma linha em pedaços lado a lado: junta de volta
  const visuais = [];
  for (const p of pedacos.sort((a, b) => (a.t + a.b) - (b.t + b.b))) {
    const alt = p.b - p.t;
    const v = visuais.find((v) => {
      const sobreY = Math.min(p.b, v.b) - Math.max(p.t, v.t);
      const vaoX = Math.max(p.l, v.l) - Math.min(p.r, v.r);
      return sobreY > Math.min(alt, v.b - v.t) * 0.5 && vaoX < Math.max(alt, v.b - v.t) * 1.5;
    });
    if (v) {
      v.partes.push(p);
      v.l = Math.min(v.l, p.l); v.t = Math.min(v.t, p.t); v.r = Math.max(v.r, p.r); v.b = Math.max(v.b, p.b);
    } else visuais.push({ partes: [p], l: p.l, t: p.t, r: p.r, b: p.b });
  }
  const boas = visuais.map((v) => {
    const partes = v.partes.sort((a, b) => a.l - b.l);
    const palavras = partes.flatMap((p) => p.palavras);
    return {
      l: v.l, t: v.t, r: v.r, b: v.b, palavras, texto: partes.map((p) => p.texto).join(" "),
      conf: palavras.reduce((a, p) => a + p.conf, 0) / palavras.length,
    };
  }).sort((a, b) => a.t - b.t || a.l - b.l);
  // 2) linhas uma embaixo da outra, perto e centralizadas juntas: mesmo balão
  const grupos = [];
  for (const ln of boas) {
    const alt = ln.b - ln.t;
    const g = grupos.find((g) => {
      const ult = g.linhas.at(-1);
      const vao = ln.t - ult.b;
      const cruzaX = Math.min(ln.r, g.r) - Math.max(ln.l, g.l);
      const centro = Math.abs((ln.l + ln.r) / 2 - (g.l + g.r) / 2);
      return vao < Math.max(alt, ult.b - ult.t) && vao > -alt && cruzaX > 0 && centro < Math.max(ln.r - ln.l, g.r - g.l) * 0.5;
    });
    if (g) {
      g.linhas.push(ln);
      g.l = Math.min(g.l, ln.l); g.t = Math.min(g.t, ln.t); g.r = Math.max(g.r, ln.r); g.b = Math.max(g.b, ln.b);
    } else grupos.push({ linhas: [ln], l: ln.l, t: ln.t, r: ln.r, b: ln.b });
  }
  return grupos.map((g) => {
    const palavras = g.linhas.flatMap((ln) => ln.palavras);
    return {
      l: g.l, t: g.t, r: g.r, b: g.b,
      texto: g.linhas.map((ln) => ln.texto).join(" ").replace(/(\w)- (\w)/g, "$1$2"),
      conf: palavras.reduce((a, p) => a + p.conf, 0) / palavras.length,
      palavras,
    };
  });
}

/**
 * O OCR leu bem o suficiente para dispensar a IA com imagem? Confiança média alta e poucas palavras
 * duvidosas. Quando não, a página vai pela IA com imagem (mais cara, mas lê letra estilizada).
 * `linhas` são todas as linhas lidas, inclusive o que virou ruído: muito ruído e nenhum texto bom
 * costuma ser letra que o Tesseract não consegue ler (borrada, torta, desenhada).
 */
export function ocrConfiavel(grupos, linhas = []) {
  const palavras = grupos.flatMap((g) => g.palavras);
  if (!palavras.length) return linhas.flatMap((l) => l.palavras).filter((p) => p.conf < 50).length < 3; // senão é só desenho
  const media = palavras.reduce((a, p) => a + p.conf, 0) / palavras.length;
  const ruins = palavras.filter((p) => p.conf < 60).length / palavras.length;
  return media >= 70 && ruins <= 0.35;
}

function mediana(v) {
  const s = v.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** Linhas já traduzidas do capítulo, mandadas junto para manter nomes e tom coerentes entre pedaços. */
export function textoContexto(linhas) {
  return linhas.length ? `Earlier lines of this chapter, for consistent names and tone (do not output them): ${linhas.join(" / ")}` : "";
}

/**
 * Junta itens do mesmo balão (o modelo às vezes devolve cada linha ou coluna separada): dois itens
 * cujas áreas de balão se sobrepõem bastante são o mesmo balão. Itens: {chave, texto, cobre, area, ...}.
 */
export function mesclar(itens) {
  const saida = [];
  for (const it of itens) {
    const alvo = saida.find((o) => sobreposicao(o.area, it.area) > 0.3);
    if (!alvo) { saida.push({ ...it, cobre: { ...it.cobre }, area: { ...it.area } }); continue; }
    alvo.texto = [alvo.texto, it.texto].filter(Boolean).join(" ");
    alvo.uniforme = alvo.uniforme && it.uniforme;
    for (const k of ["cobre", "area"]) {
      alvo[k] = {
        l: Math.min(alvo[k].l, it[k].l), t: Math.min(alvo[k].t, it[k].t),
        r: Math.max(alvo[k].r, it[k].r), b: Math.max(alvo[k].b, it[k].b),
      };
    }
  }
  return saida;
}

/** Fração da menor caixa coberta pela interseção das duas. */
export function sobreposicao(a, b) {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min((a.r - a.l) * (a.b - a.t), (b.r - b.l) * (b.b - b.t));
}
