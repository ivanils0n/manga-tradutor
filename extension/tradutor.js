// Mesmo prompt e formato de resposta do app Android (android/.../Tradutor.kt).
export const PROMPT =
  "Esta imagem é um print de uma página de mangá, manhwa ou manhua. " +
  "Encontre cada balão de fala e caixa de texto e traduza o texto para português do Brasil, de forma natural. " +
  'Responda SOMENTE em JSON neste formato: {"baloes":[{"caixa":[x1,y1,x2,y2],"texto":"tradução"}]} ' +
  "com as coordenadas normalizadas de 0 a 1000 em relação à imagem (x a partir da esquerda, y a partir do topo), " +
  "cobrindo o balão inteiro. Ignore onomatopeias e textos da interface do site. " +
  'Se não houver texto, responda {"baloes":[]}.';

export async function traduzir(imagemDataUrl, chave, modelo) {
  const resp = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: modelo,
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
  const texto = await resp.text();
  if (!resp.ok) throw new Error(`API ${resp.status}: ${texto.slice(0, 300)}`);
  return interpretar(JSON.parse(texto).choices[0].message.content);
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
    const c = o?.caixa;
    const texto = String(o?.texto ?? "").trim();
    if (!Array.isArray(c) || c.length !== 4 || !texto) return [];
    const n = c.map(Number);
    if (n.some(Number.isNaN)) return [];
    const [x1, y1, x2, y2] = n.map((v) => Math.min(Math.max(v, 0), 1000) / 1000);
    if (x1 === x2 || y1 === y2) return [];
    return [{ l: Math.min(x1, x2), t: Math.min(y1, y2), r: Math.max(x1, x2), b: Math.max(y1, y2), texto }];
  });
}

/** Converte balões normalizados no recorte r ({x,y,w,h} em 0..1 da tela) para normalizados na tela. */
export function paraTela(baloes, r) {
  return baloes.map((b) => ({
    l: r.x + b.l * r.w, t: r.y + b.t * r.h, r: r.x + b.r * r.w, b: r.y + b.b * r.h, texto: b.texto,
  }));
}
