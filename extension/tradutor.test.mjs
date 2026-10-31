import assert from "node:assert/strict";
import {
  interpretar, paraTela, parciais, pedacos, montarPrompt, analisarBalao, amostrar, mesclar, sobreposicao, textoContexto,
  montarPromptTexto, itensTexto, interpretarTexto, parciaisTexto, nomesDe, juntarGlossario, obraDoTitulo,
  preencherBordas, linhasDoTsv, agruparLinhas, ocrConfiavel, faixasPorVaos,
} from "./tradutor.js";
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
for (let ty = 130; ty < 170; ty += 8) for (let tx = 180; tx < 220; tx += 8) pintar(tx, ty, tx + 5, ty + 5, [0, 0, 0]); // "letras" de um texto estreito
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
  const uso = {};
  const texto = await chamar(cfg, { prompt: "P", imagem: "data:image/jpeg;base64,QUJD" }, { aoTexto: (t) => vistos.push(parciais(t)), uso });
  assert.ok(uso.estimado && uso.entrada >= 1000, tipo + ": sem contagem da API, estima"); 
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
assert.equal(await chamar({ def: { tipo: "openai" }, modelo: "m", chave: "k", url: "u" }, { prompt: "P", imagem: "data:," }), '{"t":[]}');
assert.equal(chamadas, 2);
chamadas = 0; // o modelo que recusou os extras não paga a tentativa dupla de novo
await chamar({ def: { tipo: "openai" }, modelo: "m", chave: "k", url: "u" }, { prompt: "P", imagem: "data:," });
assert.equal(chamadas, 1);
globalThis.fetch = async () => new Response('{"error":{"message":"bad key"}}', { status: 401 });
await assert.rejects(chamar({ def: { tipo: "openai" }, modelo: "m", chave: "k", url: "u2" }, { prompt: "P", imagem: "data:," }), /Chave da API inválida/);
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
await chamar({ def: { tipo: "openai" }, modelo: "m", chave: "k", url: "u3" }, { prompt: "P", imagem: "data:image/jpeg;base64,AA", depois: "CTX" });
assert.deepEqual(ultimoCorpo.messages[0].content.map((c) => c.type), ["text", "image_url", "text"]);
assert.equal(ultimoCorpo.messages[0].content[2].text, "CTX");
// modo só texto (inglês lido no PC): nada de imagem; a contagem de tokens da API é usada quando vem
globalThis.fetch = async (_u, init) => {
  ultimoCorpo = JSON.parse(init.body);
  const sse = ['{"choices":[{"delta":{"content":"{\\"t\\":[\\"Oi\\"]}"}}]}', '{"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":9}}']
    .map((d) => `data: ${d}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(sse, { headers: { "content-type": "text/event-stream" } });
};
const usoTexto = {};
assert.equal(await chamar({ def: { tipo: "openai" }, modelo: "m", chave: "k", url: "u4" }, { prompt: "P", depois: "1. Hi" }, { uso: usoTexto }), '{"t":["Oi"]}');
assert.deepEqual(ultimoCorpo.messages[0].content.map((c) => c.type), ["text", "text"]);
assert.deepEqual(usoTexto, { entrada: 120, saida: 9 });
// ---- encaixe pela imagem: caixa da IA deslocada ou apertada demais ainda acha o texto inteiro
const dentro = (cx, t) => cx.l <= t.l && cx.t <= t.t && cx.r >= t.r && cx.b >= t.b;
const TXT = { l: 180, t: 130, r: 220, b: 170 }; // o "texto" pintado no balão sintético
for (const [nome, caixaIA] of [["deslocada", { l: 170, t: 120, r: 212, b: 162 }], ["apertada", { l: 190, t: 140, r: 210, b: 160 }], ["folgada", { l: 150, t: 100, r: 260, b: 200 }]]) {
  const r = analisarBalao({ data, width: W, height: H }, caixaIA);
  assert.ok(r.uniforme, nome + ": achou o fundo do balão");
  assert.ok(dentro(r.cobre, TXT), `${nome}: cobre o texto todo ${JSON.stringify(r.cobre)}`);
  assert.ok(r.cobre.l >= 104 && r.cobre.r <= 296 && r.cobre.t >= 84 && r.cobre.b <= 216, nome + ": sem passar do contorno");
  assert.ok(r.cobre.r - r.cobre.l < 70, nome + ": encolheu para o texto");
}

// ---- legenda sobre degradê: não é balão; fica do tamanho do texto e ganha remendo
const DW = 600, DH = 200, deg = new Uint8ClampedArray(DW * DH * 4);
for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) { const v = 60 + y; deg.set([v, v + 20, 160, 255], (y * DW + x) * 4); }
for (let x = 200; x < 400; x += 6) for (let y = 90; y < 110; y++) deg.set([255, 255, 255, 255], (y * DW + x) * 4);
const leg = analisarBalao({ data: deg, width: DW, height: DH }, { l: 198, t: 88, r: 402, b: 112 });
assert.equal(leg.uniforme, false);
assert.ok(leg.area.r - leg.area.l < 260, "não se espalha pelo degradê: " + JSON.stringify(leg.area));

// ---- remendo: degradê da esquerda (preto) para a direita (branco) é reconstruído no meio
const GW = 200, GH = 100, grad = new Uint8ClampedArray(GW * GH * 4);
for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const v = Math.round((x / (GW - 1)) * 255); grad.set([v, v, v, 255], (y * GW + x) * 4); }
for (let y = 40; y < 60; y++) for (let x = 80; x < 120; x++) grad.set([255, 0, 0, 255], (y * GW + x) * 4); // "texto" vermelho
const rem = preencherBordas({ data: grad, width: GW, height: GH }, { l: 76, t: 36, r: 124, b: 64 });
const meio = (rem.h >> 1) * rem.w * 4 + (rem.w >> 1) * 4;
assert.ok(Math.abs(rem.data[meio] - 127) < 20 && Math.abs(rem.data[meio] - rem.data[meio + 1]) < 4, "meio do remendo é cinza, sem vermelho");
const esqR = (rem.h >> 1) * rem.w * 4;
assert.ok(rem.data[esqR] < rem.data[meio], "degradê mantido");

// ---- modo inglês: TSV do Tesseract → linhas → balões
const tsv = [
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
  "5\t1\t1\t1\t1\t1\t100\t100\t60\t20\t95\tWHERE", "5\t1\t1\t1\t1\t2\t165\t100\t30\t20\t94\tDO",
  "5\t1\t2\t1\t1\t1\t110\t126\t80\t20\t93\tYOU'RE", "5\t1\t2\t1\t1\t2\t195\t126\t50\t20\t90\tGOING?",
  "5\t1\t3\t1\t1\t1\t500\t110\t40\t20\t83\t|", "5\t1\t3\t1\t1\t2\t545\t110\t50\t20\t96\tWIN!",
  "5\t1\t4\t1\t1\t1\t300\t600\t25\t12\t59\titi",
  "5\t1\t5\t1\t1\t1\t100\t400\t50\t20\t-1\t ",
].join("\n");
const linhas = linhasDoTsv(tsv);
assert.equal(linhas.length, 4);
const grupos = agruparLinhas(linhas);
assert.deepEqual(grupos.map((g) => g.texto), ["WHERE DO YOU'RE GOING?", "| WIN!"]); // "iti" é ruído; balões separados
assert.deepEqual([grupos[0].l, grupos[0].t, grupos[0].r, grupos[0].b], [100, 100, 245, 146]);
assert.equal(ocrConfiavel(grupos), true);
assert.equal(ocrConfiavel([{ palavras: [{ conf: 40 }, { conf: 55 }, { conf: 90 }] }]), false);
assert.equal(ocrConfiavel([]), true); // página sem texto
const lixo = linhasDoTsv(["5\t1\t1\t1\t1\t1\t0\t0\t9\t9\t3\t‘hi", "5\t1\t2\t1\t1\t1\t0\t20\t9\t9\t34\t1009", "5\t1\t3\t1\t1\t1\t0\t40\t9\t9\t10\t#", "5\t1\t4\t1\t1\t1\t0\t60\t9\t9\t64\twow"].join("\n"));
assert.deepEqual(agruparLinhas(lixo), []); // tudo ruído…
assert.equal(ocrConfiavel([], lixo), false); // …mas tanto ruído assim é letra que o OCR não leu: vai pela IA com imagem
assert.equal(agruparLinhas(linhasDoTsv("5\t1\t1\t1\t1\t1\t0\t0\t40\t20\t90\tWAIT-\n5\t1\t2\t1\t1\t1\t0\t22\t40\t20\t90\tING"))[0].texto, "WAITING");
// linha partida em pedaços lado a lado (texto esparso) e linhas com vão de quase uma linha: um balão só
const partida = linhasDoTsv([
  "5\t1\t1\t1\t1\t1\t470\t400\t12\t15\t75\tI", "5\t1\t1\t1\t1\t2\t486\t400\t60\t15\t75\tTOLD",
  "5\t1\t2\t1\t1\t1\t552\t401\t140\t15\t96\tYOU ALREADY!",
  "5\t1\t3\t1\t1\t1\t475\t427\t210\t15\t95\tI'M NOT GOING BACK!",
].join("\n"));
assert.deepEqual(agruparLinhas(partida).map((g) => g.texto), ["I TOLD YOU ALREADY! I'M NOT GOING BACK!"]);

// ---- modo inglês: prompt, itens, resposta e streaming
const pt = montarPromptTexto({ idioma: "pt-BR", honorificos: false, onomatopeias: false, glossario: "Bob = Beto", glossarioAuto: [["Bob", "Roberto"], ["Ann", "Ana"]], aprender: true });
assert.match(pt, /OCR/);
assert.match(pt, /Bob→Beto; Ann→Ana/); // o glossário do usuário vence o automático
assert.match(pt, /"n"/);
assert.doesNotMatch(montarPrompt({ idioma: "pt-BR" }), /"n"/);
assert.equal(itensTexto(["Oi", "Tchau"]), "1. Oi\n2. Tchau");
assert.deepEqual(interpretarTexto('{"t":["Olá"," Ei! "]}', 3), ["Olá", "Ei!", ""]);
assert.deepEqual(interpretarTexto('{"t":["Olá","Ei, esp', 2), ["Olá", "Ei, esp"]);
assert.deepEqual(parciaisTexto('{"t":[]}'), []);
assert.deepEqual(parciaisTexto('{"t":["a\\"b","c"],"n":[["X","Y"]]}'), ['a"b', "c"]);
assert.deepEqual(nomesDe('{"t":["a"],"n":[["Bob","Beto"],[1,2],["",""]]}'), [["Bob", "Beto"]]);
assert.deepEqual(nomesDe("lixo"), []);
assert.deepEqual(juntarGlossario([["Bob", "Beto"], ["Ann", "Ana"]], [["bob", "Roberto"], ["Zé", "Zé"]], 3), [["Ann", "Ana"], ["bob", "Roberto"], ["Zé", "Zé"]]);
assert.equal(obraDoTitulo("One Piece - Chapter 1100 - MangaDex", "s"), "s|one piece");
assert.equal(obraDoTitulo("One Piece Capítulo 12", "s"), "s|one piece");
assert.equal(obraDoTitulo("Chapter 3 - Algo", "s"), "s|");
// uma chamada por balão: a IA vê a página toda, mas devolve só o item pedido
const pu = montarPromptTexto({ idioma: "pt-BR" }, true);
assert.match(pu, /only the item\(s\) asked at the end/);
assert.match(pu, /\{"t":\["translation"\]\}/);
assert.doesNotMatch(pu, /one string per item/);

// ---- faixas pelos vãos entre os quadros: nunca na margem, nem no espaço entre linhas de texto
{
  const w = 600, h = 1200;
  const img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let i = 0; i < img.data.length; i += 4) img.data.fill((i * 7919) % 251, i, i + 3), (img.data[i + 3] = 255); // desenho
  const liso = (t, b) => img.data.fill(255, t * w * 4, b * w * 4);
  assert.deepEqual(faixasPorVaos(img), [[0, 1200]]); // sem vão: inteira
  liso(0, 40); liso(1170, 1200); // margens
  liso(600, 606); // entre linhas de texto
  assert.deepEqual(faixasPorVaos(img), [[0, 1200]]);
  liso(395, 425); liso(790, 822); // vãos entre quadros
  assert.deepEqual(faixasPorVaos(img), [[0, 410], [410, 806], [806, 1200]]);
  assert.deepEqual(faixasPorVaos(img, 500), [[0, 1200]]); // nenhum vão deixa as duas partes com 500 px
  assert.deepEqual(faixasPorVaos({ ...img, height: 700, data: img.data.subarray(0, w * 700 * 4) }), [[0, 700]]); // baixa demais para dividir
}
console.log("ok");
