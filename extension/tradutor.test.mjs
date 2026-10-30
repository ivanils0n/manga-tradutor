import assert from "node:assert/strict";
import { interpretar, paraTela, parciais, pedacos } from "./tradutor.js";

const r = interpretar('ok ```{"baloes":[{"caixa":[500,100,100,300],"texto":" Oi "},{"caixa":[1,2,3],"texto":"x"},{"caixa":[0,0,0,10],"texto":"y"},{"caixa":[0,0,2000,10],"texto":"z"}]}```');
assert.deepEqual(r, [
  { l: 0.1, t: 0.1, r: 0.5, b: 0.3, texto: "Oi" },
  { l: 0, t: 0, r: 1, b: 0.01, texto: "z" },
]);
assert.deepEqual(interpretar("sem json"), []);
assert.deepEqual(interpretar("{quebrado}"), []);
assert.deepEqual(
  paraTela([{ l: 0, t: 0.5, r: 1, b: 1, texto: "a" }], { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }),
  [{ l: 0.25, t: 0.625, r: 0.75, b: 0.75, texto: "a" }],
);

// streaming: caixa completa sem texto, texto pela metade (com escape cortado), caixa incompleta
const p = parciais('{"baloes":[{"caixa":[100,100,200,200],"texto":"Olá \\"mun"},{"caixa":[300,300,400,400]},{"caixa":[500,5');
assert.deepEqual(p, [
  { l: 0.1, t: 0.1, r: 0.2, b: 0.2, texto: 'Olá "mun' },
  { l: 0.3, t: 0.3, r: 0.4, b: 0.4, texto: "" },
]);
assert.equal(parciais('{"baloes":[{"caixa":[1,1,9,9],"texto":"a\\')[0].texto, "a");
assert.equal(parciais('{"baloes":[{"caixa":[1,1,9,9],"texto":"a\\u00e')[0].texto, "a");

// pedaços: cobrem a área inteira, nenhum passa do lado, donos não se sobrepõem e cobrem tudo
for (const a of [{ x: 0, y: 0, w: 800, h: 900 }, { x: 100, y: 50, w: 1900, h: 1000 }, { x: 0, y: 0, w: 1200, h: 3100 }]) {
  const ps = pedacos(a);
  for (const q of ps) {
    assert.ok(q.w <= 1000 && q.h <= 1000, "pedaço grande demais");
    assert.ok(q.x >= a.x && q.y >= a.y && q.x + q.w <= a.x + a.w + 1 && q.y + q.h <= a.y + a.h + 1, "fora da área");
  }
  const xs = [...new Set(ps.map((q) => q.dono.x0 + ":" + q.dono.x1))].map((s) => s.split(":").map(Number));
  assert.equal(xs[0][0], a.x);
  assert.ok(Math.abs(xs.at(-1)[1] - (a.x + a.w)) < 1e-6);
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i][0] - xs[i - 1][1]) < 1e-6, "donos com buraco");
  const ys = [...new Set(ps.map((q) => q.dono.y0 + ":" + q.dono.y1))].map((s) => s.split(":").map(Number));
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i][0] - ys[i - 1][1]) < 1e-6, "donos com buraco (y)");
}
assert.equal(pedacos({ x: 0, y: 0, w: 800, h: 900 }).length, 1);
assert.equal(pedacos({ x: 0, y: 0, w: 1200, h: 3100 }).length, 2 * 4);
console.log("ok");

// streaming de ponta a ponta com fetch falso (SSE em pedaços quebrados no meio da linha)
const conteudo = '{"baloes":[{"caixa":[100,100,300,200],"texto":"Olá, tudo bem?"},{"caixa":[500,500,900,700],"texto":"Sim!"}]}';
const sse = conteudo.match(/.{1,7}/gs).map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join("") + "data: [DONE]\n\n";
globalThis.fetch = async () => new Response(new ReadableStream({
  start(c) { for (const p of sse.match(/[\s\S]{1,13}/g)) c.enqueue(new TextEncoder().encode(p)); c.close(); },
}));
const vistos = [];
const { traduzir } = await import("./tradutor.js");
const fim = await traduzir("data:x", "k", "m", (bs) => vistos.push(bs));
assert.deepEqual(fim.map((b) => b.texto), ["Olá, tudo bem?", "Sim!"]);
assert.ok(vistos.some((bs) => bs.length === 1 && bs[0].texto === ""), "caixa antes do texto");
assert.ok(vistos.some((bs) => bs[0]?.texto && bs[0].texto !== "Olá, tudo bem?"), "texto parcial");
console.log("stream ok");
