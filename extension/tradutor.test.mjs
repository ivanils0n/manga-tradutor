import assert from "node:assert/strict";
import { interpretar, paraTela, parciais, pedacos, montarPrompt, analisarBalao, amostrar, mesclar, sobreposicao, textoContexto } from "./tradutor.js";
import { chamar } from "./provedores.js";

const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// ---- resposta final: formato compacto, variações e erros
assert.deepEqual(interpretar('```json\n{"t":[[100,100,500,300," Oi "],[1,2,3,"x"],[0,0,0,10,"y"]]}\n```'), [
  { l: 0.1, t: 0.1, r: 0.5, b: 0.3, texto: "Oi" },
]);
assert.deepEqual(interpretar('{"baloes":[{"caixa":[500,100,100,300],"texto":"a"}]}'), [{ l: 0.1, t: 0.1, r: 0.5, b: 0.3, texto: "a" }]);
assert.deepEqual(interpretar('[{"box_2d":[100,200,300,400],"text":"b"}]', "yx"), [{ l: 0.2, t: 0.1, r: 0.4, b: 0.3, texto: "b" }]);
assert.deepEqual(interpretar('{"t":[[0.1,0.1,0.5,0.3,"c"]]}'), [{ l: 0.1, t: 0.1, r: 0.5, b: 0.3, texto: "c" }]);
assert.deepEqual(interpretar("sem json"), []);
assert.deepEqual(interpretar('{"t":[]}'), []);
// cortada no meio (limite de tokens): aproveita o que veio completo
assert.deepEqual(interpretar('{"t":[[100,100,500,300,"Oi"],[600,6'), [{ l: 0.1, t: 0.1, r: 0.5, b: 0.3, texto: "Oi" }]);

// ---- streaming: caixa antes do texto, texto pela metade, escape cortado
assert.deepEqual(parciais('{"t":[[100,100,200,200,"Olá \\"mun'), [{ l: 0.1, t: 0.1, r: 0.2, b: 0.2, texto: 'Olá "mun' }]);
assert.deepEqual(parciais('{"t":[[100,100,200,200,'), [{ l: 0.1, t: 0.1, r: 0.2, b: 0.2, texto: "" }]);
assert.deepEqual(parciais('{"t":[[100,100,200,2'), []); // último número pode estar incompleto
assert.equal(parciais('{"t":[[1,1,90,90,"a\\u00e')[0].texto, "a");
assert.deepEqual(parciais('{"baloes":[{"caixa":[100,100,200,200],"texto":"x'), [{ l: 0.1, t: 0.1, r: 0.2, b: 0.2, texto: "x" }]);

perto(paraTela([{ l: 0, t: 0.5, r: 1, b: 1, texto: "a" }], { x: 0.25, y: 0.5, w: 0.5, h: 0.25 })[0].t, 0.625);

// ---- prompt
const p = montarPrompt({ idioma: "pt-BR", honorificos: true, onomatopeias: false, glossario: "Luffy = Luffy\nGomu Gomu → Borracha\nlixo" });
assert.match(p, /Brazilian Portuguese/);
assert.match(p, /Gomu Gomu→Borracha/);
assert.doesNotMatch(p, /lixo/);
assert.match(montarPrompt({ idioma: "en" }, "yx"), /ymin,xmin,ymax,xmax/);

// ---- pedaços: cobrem a área, nenhum passa do lado, donos sem buraco
for (const a of [{ x: 0, y: 0, w: 800, h: 900 }, { x: 100, y: 50, w: 1900, h: 1000 }, { x: 0, y: 0, w: 1200, h: 3100 }]) {
  const ps = pedacos(a);
  for (const q of ps) assert.ok(q.w <= 1280 && q.h <= 1280 && q.x >= a.x && q.y >= a.y, "pedaço fora");
  for (const eixo of ["x", "y"]) {
    const d = [...new Set(ps.map((q) => q.dono[eixo + "0"] + ":" + q.dono[eixo + "1"]))].map((s) => s.split(":").map(Number));
    perto(d[0][0], a[eixo]);
    perto(d.at(-1)[1], a[eixo] + (eixo === "x" ? a.w : a.h));
    for (let i = 1; i < d.length; i++) perto(d[i][0], d[i - 1][1]);
  }
}
assert.equal(pedacos({ x: 0, y: 0, w: 800, h: 900 }).length, 1);

// ---- análise do balão numa imagem sintética: fundo creme, balão (retângulo) com contorno preto e texto
const W = 400, H = 300;
const data = new Uint8ClampedArray(W * H * 4);
const pintar = (l, t, r, b, cor) => {
  for (let y = t; y < b; y++) for (let x = l; x < r; x++) data.set([...cor, 255], (y * W + x) * 4);
};
pintar(0, 0, W, H, [90, 90, 120]); // arte
pintar(100, 80, 300, 220, [0, 0, 0]); // contorno
pintar(104, 84, 296, 216, [250, 245, 230]); // interior creme
pintar(180, 130, 220, 170, [0, 0, 0]); // "texto" japonês, estreito
const a = analisarBalao({ data, width: W, height: H }, { l: 178, t: 128, r: 222, b: 172 });
assert.equal(a.fundo, "#faf5e6");
assert.ok(a.uniforme && a.claro);
assert.ok(a.area.l <= 112 && a.area.l >= 104, "cresce até perto do contorno esquerdo: " + a.area.l);
assert.ok(a.area.r >= 288 && a.area.r <= 296, "direito: " + a.area.r);
assert.ok(a.area.t < 128 && a.area.t >= 84, "cima: " + a.area.t);
// texto sobre arte: não cresce
const b = analisarBalao({ data, width: W, height: H }, { l: 20, t: 20, r: 60, b: 40 });
assert.ok(b.uniforme); // arte lisa aqui
const ruido = new Uint8ClampedArray(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7919) % 256));
assert.equal(analisarBalao({ data: ruido, width: W, height: H }, { l: 50, t: 50, r: 100, b: 90 }).uniforme, false);

// ---- amostra: liso x desenhado, e o mesmo pedaço dá o mesmo hash
const liso = amostrar({ data, width: W }, { x: 0, y: 0, w: 90, h: 70 });
const balao = amostrar({ data, width: W }, { x: 90, y: 70, w: 220, h: 160 });
assert.ok(liso.desvio < 1 && balao.desvio > 20);
assert.equal(amostrar({ data, width: W }, { x: 90, y: 70, w: 220, h: 160 }).hash, balao.hash);

// ---- provedores: streaming de cada tipo de API, com o SSE quebrado no meio das linhas
const conteudo = '{"t":[[100,100,300,200,"Olá, tudo bem?"],[500,500,900,700,"Sim!"]]}';
const pedacosTexto = conteudo.match(/.{1,7}/gs);
const eventos = {
  openai: (c) => ({ choices: [{ delta: { content: c } }] }),
  gemini: (c) => ({ candidates: [{ content: { parts: [{ text: c }] } }] }),
  claude: (c) => ({ type: "content_block_delta", delta: { type: "text_delta", text: c } }),
};
for (const [tipo, ev] of Object.entries(eventos)) {
  const sse = pedacosTexto.map((c) => `data: ${JSON.stringify(ev(c))}\n\n`).join("") + "data: [DONE]\n\n";
  let pedido;
  globalThis.fetch = async (url, init) => {
    pedido = { url, corpo: JSON.parse(init.body), headers: init.headers };
    return new Response(new ReadableStream({
      start(c) { for (const s of sse.match(/[\s\S]{1,13}/g)) c.enqueue(new TextEncoder().encode(s)); c.close(); },
    }), { headers: { "content-type": "text/event-stream" } });
  };
  const vistos = [];
  const cfg = { def: { tipo, extras: {} }, modelo: "m", chave: "k", url: "https://x" };
  const texto = await chamar(cfg, "data:image/jpeg;base64,QUJD", "P", (t) => vistos.push(parciais(t)));
  assert.equal(texto, conteudo, tipo);
  assert.ok(vistos.some((bs) => bs.length === 1 && bs[0].texto !== "Olá, tudo bem?"), tipo + ": balão antes do texto completo");
  if (tipo === "gemini") assert.equal(pedido.corpo.contents[0].parts[1].inline_data.data, "QUJD");
  if (tipo === "claude") assert.equal(pedido.headers["x-api-key"], "k");
  if (tipo === "openai") assert.equal(pedido.url, "https://x/chat/completions");
}

// parâmetro opcional recusado (400) → repete sem os extras
let chamadas = 0;
globalThis.fetch = async (_u, init) => {
  chamadas++;
  if (JSON.parse(init.body).temperature !== undefined) return new Response('{"error":{"message":"temperature unsupported"}}', { status: 400 });
  return new Response(JSON.stringify({ choices: [{ message: { content: '{"t":[]}' } }] }), { headers: { "content-type": "application/json" } });
};
assert.equal(await chamar({ def: { tipo: "openai" }, modelo: "m", chave: "k", url: "u" }, "data:,", "P"), '{"t":[]}');
assert.equal(chamadas, 2);
globalThis.fetch = async () => new Response('{"error":{"message":"bad key"}}', { status: 401 });
await assert.rejects(chamar({ def: { tipo: "openai" }, modelo: "m", chave: "k", url: "u" }, "data:,", "P"), /Chave da API inválida/);
// ---- junção de partes do mesmo balão (linhas/colunas devolvidas separadas)
const item = (chave, texto, area, cobre = area) => ({ chave, texto, fundo: "#fff", claro: true, uniforme: true, area, cobre });
const juntos = mesclar([
  item("a", "Ei,", { l: 0.1, t: 0.1, r: 0.4, b: 0.3 }, { l: 0.2, t: 0.12, r: 0.25, b: 0.28 }),
  item("b", "espera!", { l: 0.12, t: 0.1, r: 0.42, b: 0.3 }, { l: 0.27, t: 0.12, r: 0.32, b: 0.28 }),
  item("c", "Outro balão", { l: 0.6, t: 0.6, r: 0.9, b: 0.8 }),
]);
assert.equal(juntos.length, 2);
assert.equal(juntos[0].chave, "a"); // a chave do primeiro fica: o balão não pisca no streaming
assert.equal(juntos[0].texto, "Ei, espera!");
assert.deepEqual(juntos[0].cobre, { l: 0.2, t: 0.12, r: 0.32, b: 0.28 });
perto(sobreposicao({ l: 0, t: 0, r: 1, b: 1 }, { l: 0.5, t: 0.5, r: 1.5, b: 1.5 }), 0.25);
assert.equal(sobreposicao({ l: 0, t: 0, r: 1, b: 1 }, { l: 2, t: 2, r: 3, b: 3 }), 0);
assert.equal(textoContexto([]), "");
assert.match(textoContexto(["Oi", "Tudo bem?"]), /Oi \/ Tudo bem\?/);

// contexto vai depois da imagem (o começo da mensagem fica igual entre chamadas: cache de prefixo)
let ultimoCorpo;
globalThis.fetch = async (_u, init) => {
  ultimoCorpo = JSON.parse(init.body);
  return new Response(JSON.stringify({ choices: [{ message: { content: '{"t":[]}' } }] }), { headers: { "content-type": "application/json" } });
};
await chamar({ def: { tipo: "openai" }, modelo: "m", chave: "k", url: "u" }, "data:image/jpeg;base64,AA", "P", undefined, undefined, "CTX");
assert.deepEqual(ultimoCorpo.messages[0].content.map((c) => c.type), ["text", "image_url", "text"]);
assert.equal(ultimoCorpo.messages[0].content[2].text, "CTX");
console.log("ok");
