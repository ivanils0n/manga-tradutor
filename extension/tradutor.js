// Lógica pura (sem APIs do navegador): prompt, leitura da resposta, pedaços da tela e análise do balão.

const LINGUA = {
  "pt-BR": "Brazilian Portuguese", "pt-PT": "European Portuguese", en: "English", es: "Spanish",
  fr: "French", it: "Italian", de: "German",
};

/**
 * Prompt curto (economiza tokens) e em inglês, que os modelos seguem melhor. Formato de saída em lista
 * compacta [caixa..., "texto"] para gastar o mínimo de tokens de resposta; a caixa vem antes do texto
 * para o balão ser coberto antes da tradução terminar de chegar.
 */
export function montarPrompt(o, coords = "xy") {
  const caixa = coords === "yx" ? "ymin,xmin,ymax,xmax" : "x1,y1,x2,y2";
  const glossario = String(o.glossario || "")
    .split("\n").map((l) => l.split(/\s*(?:=|->|→)\s*/)).filter((p) => p.length === 2 && p[0] && p[1])
    .map(([a, b]) => `${a.trim()}→${b.trim()}`).join("; ").slice(0, 600);
  return [
    "Manga/manhwa/manhua image. Find every speech bubble, thought bubble, narration box and text block" +
      (o.onomatopeias ? ", including sound effects." : ". Skip sound effects.") +
      " Skip watermarks, page numbers and website UI.",
    `Translate each into natural, fluent ${LINGUA[o.idioma] || o.idioma}, like a professional scanlation: ` +
      "keep each character's voice and the scene's context, join text split across lines, keep it short to fit the bubble." +
      (o.honorificos ? " Keep Japanese honorifics (-san, -kun, -chan, -sama, senpai)." : ""),
    glossario && `Glossary, always use: ${glossario}`,
    `Reply ONLY with JSON in reading order: {"t":[[${caixa},"translation"]]}`,
    `${caixa}: tight box around the original text, integers 0-1000 relative to this image. No text: {"t":[]}`,
  ].filter(Boolean).join("\n");
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
 * Divide a área {x,y,w,h} (pixels) em pedaços de até `lado` px, com sobreposição.
 * Cada pedaço tem `dono`: a parte onde um balão centrado nele pertence a ele (evita duplicar
 * balões que caem na sobreposição).
 */
export function pedacos(a, lado = 1100, sobra = 0.25) {
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

/**
 * Analisa o balão na imagem a partir da caixa do texto original (pixels {l,t,r,b}):
 * - fundo: cor mediana logo fora do texto (cobre o original sem "remendo" branco num balão creme);
 * - area: até onde o fundo continua liso, ou seja, o interior do balão. A tradução usa essa área,
 *   que costuma ser bem maior que o texto original (português ocupa mais espaço que japonês).
 */
export function analisarBalao(img, c) {
  const { data, width: W, height: H } = img;
  const px = (x, y) => {
    const i = (Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const m = Math.max(3, Math.round(Math.min(c.r - c.l, c.b - c.t) * 0.06));
  const l = c.l - m, t = c.t - m, r = c.r + m, b = c.b + m;
  const amostras = [];
  const passo = Math.max(1, ((r - l) + (b - t)) / 80);
  for (let x = l; x <= r; x += passo) amostras.push(px(x, t), px(x, b));
  for (let y = t; y <= b; y += passo) amostras.push(px(l, y), px(r, y));
  const fundo = [0, 1, 2].map((k) => mediana(amostras.map((a) => a[k])));
  const parecido = (p) => Math.abs(p[0] - fundo[0]) + Math.abs(p[1] - fundo[1]) + Math.abs(p[2] - fundo[2]) < 60;
  const uniforme = amostras.filter(parecido).length / amostras.length > 0.8;

  const area = { l, t, r, b };
  if (uniforme) {
    const linhaLisa = (x0, y0, x1, y1) => {
      const n = Math.max(2, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 3));
      let ok = 0;
      for (let k = 0; k <= n; k++) if (parecido(px(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n))) ok++;
      return ok / (n + 1) >= 0.97;
    };
    const maxX = Math.max((c.r - c.l) * 1.2, (c.b - c.t) * 0.8) + 24, maxY = (c.b - c.t) * 0.45 + 12;
    // primeiro para os lados (a tradução é horizontal e mais longa), olhando só a faixa do meio:
    // num balão oval, as pontas de cima e de baixo fechariam cedo demais
    const m0 = area.t + (area.b - area.t) * 0.25, m1 = area.b - (area.b - area.t) * 0.25;
    for (let k = 0; k < maxX && area.l > 1 && linhaLisa(area.l - 2, m0, area.l - 2, m1); k += 2) area.l -= 2;
    for (let k = 0; k < maxX && area.r < W - 2 && linhaLisa(area.r + 2, m0, area.r + 2, m1); k += 2) area.r += 2;
    for (let k = 0; k < maxY && area.t > 1 && linhaLisa(area.l, area.t - 2, area.r, area.t - 2); k += 2) area.t -= 2;
    for (let k = 0; k < maxY && area.b < H - 2 && linhaLisa(area.l, area.b + 2, area.r, area.b + 2); k += 2) area.b += 2;
  }
  const lum = (fundo[0] * 2 + fundo[1] * 5 + fundo[2]) / 8;
  return {
    fundo: "#" + fundo.map((v) => v.toString(16).padStart(2, "0")).join(""),
    claro: lum > 140,
    uniforme,
    cobre: { l, t, r, b }, // texto original + margem (como a dilatação de máscara dos tradutores de mangá)
    area,
  };
}

function mediana(v) {
  const s = v.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}
