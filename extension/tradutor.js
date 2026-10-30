// Mesmo formato de resposta do app Android (android/.../Tradutor.kt). "caixa" vem antes de "texto"
// de propósito: no streaming, o balão pode ser coberto de branco antes da tradução chegar.
export const PROMPT =
  "Esta imagem é um pedaço de uma página de mangá, manhwa ou manhua. " +
  "Encontre cada balão de fala e caixa de texto (mesmo os pequenos) e traduza o texto para português do Brasil, de forma natural. " +
  'Responda SOMENTE em JSON neste formato: {"baloes":[{"caixa":[x1,y1,x2,y2],"texto":"tradução"}]} ' +
  "com as coordenadas normalizadas de 0 a 1000 em relação à imagem (x a partir da esquerda, y a partir do topo), " +
  "cobrindo o balão inteiro. Ignore onomatopeias e textos da interface do site. " +
  'Se não houver texto, responda {"baloes":[]}.';

/**
 * Traduz em streaming: chama aoParcial(balões) conforme a resposta chega
 * (texto pode vir incompleto) e devolve a lista final.
 */
export async function traduzir(imagemDataUrl, chave, modelo, aoParcial = () => {}) {
  const resp = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: modelo,
      stream: true,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" }, // raciocínio é o que mais demora
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: imagemDataUrl } },
        ],
      }],
    }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);

  const leitor = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "", conteudo = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    resto += value;
    const linhas = resto.split("\n");
    resto = linhas.pop();
    let mudou = false;
    for (const l of linhas) {
      if (!l.startsWith("data:")) continue;
      const dado = l.slice(5).trim();
      if (dado === "[DONE]") continue;
      const delta = JSON.parse(dado).choices?.[0]?.delta?.content;
      if (delta) { conteudo += delta; mudou = true; }
    }
    if (mudou) aoParcial(parciais(conteudo));
  }
  return interpretar(conteudo);
}

/** Balões com caixa normalizada 0..1 ({l,t,r,b,texto}); ignora itens malformados. */
export function interpretar(resposta) {
  const i = resposta.indexOf("{");
  const f = resposta.lastIndexOf("}");
  if (i < 0 || f <= i) return [];
  let lista;
  try { lista = JSON.parse(resposta.slice(i, f + 1)).baloes; } catch { return []; }
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((o) => {
    const b = caixa(o?.caixa);
    const texto = String(o?.texto ?? "").trim();
    return b && texto ? [{ ...b, texto }] : [];
  });
}

/** Lê uma resposta ainda incompleta: todo balão cuja caixa já chegou, com o texto que houver até agora. */
export function parciais(json) {
  const re = /"caixa"\s*:\s*\[([^\]]*)\](?:\s*,\s*"texto"\s*:\s*"((?:[^"\\]|\\.)*))?/g;
  const lista = [];
  for (const m of json.matchAll(re)) {
    const b = caixa(m[1].split(","));
    if (!b) continue;
    let texto = "";
    if (m[2]) {
      try { texto = JSON.parse(`"${m[2].replace(/\\(u[0-9a-fA-F]{0,3})?$/, "")}"`); } catch { texto = ""; }
    }
    lista.push({ ...b, texto: texto.trim() });
  }
  return lista;
}

function caixa(c) {
  if (!Array.isArray(c) || c.length !== 4) return null;
  const n = c.map((v) => (String(v).trim() === "" ? NaN : Number(v)));
  if (n.some(Number.isNaN)) return null;
  const [x1, y1, x2, y2] = n.map((v) => Math.min(Math.max(v, 0), 1000) / 1000);
  if (x1 === x2 || y1 === y2) return null;
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
 * A API reduz cada imagem para ~800px; pedaços menores mantêm o texto legível.
 * Cada pedaço tem `dono`: a parte onde um balão centrado nele pertence a ele (evita duplicar
 * balões que caem na sobreposição).
 */
export function pedacos(a, lado = 1000, sobra = 0.25) {
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
