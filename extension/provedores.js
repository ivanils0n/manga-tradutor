// Chamada em streaming para cada tipo de API. Devolve o texto completo e avisa cada pedaço em aoTexto.

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
const recusaExtras = new Set(); // modelos que recusaram os parâmetros opcionais: não tenta de novo a cada chamada

/**
 * pedido: { prompt, imagem (data URL ou null no modo só texto), depois (texto que vai após a imagem) }.
 * uso (opcional) é preenchido com os tokens gastos: { entrada, saida, estimado }.
 */
export async function chamar(cfg, pedido, { aoTexto = () => {}, sinal, uso = {} } = {}) {
  const chaveModelo = `${cfg.url}|${cfg.modelo}`;
  let extras = !recusaExtras.has(chaveModelo);
  for (let tentativa = 0; ; tentativa++) {
    const req = montar(cfg, pedido, extras);
    const resp = await fetch(req.url, {
      method: "POST", headers: { "Content-Type": "application/json", ...req.headers },
      body: JSON.stringify(req.body), signal: sinal,
    });
    if (resp.ok) {
      const texto = await ler(resp, cfg.def.tipo, aoTexto, uso);
      if (!uso.entrada) { // a API não disse quanto gastou: estimativa (~4 letras por token, ~1000 por imagem)
        uso.entrada = Math.round(((pedido.prompt || "").length + (pedido.depois || "").length) / 4) + (pedido.imagem ? 1000 : 0);
        uso.saida = Math.round(texto.length / 4);
        uso.estimado = true;
      }
      return texto;
    }
    const corpo = (await resp.text()).slice(0, 400);
    // parâmetro opcional (temperatura, modo JSON, raciocínio…) que este modelo não aceita: tenta sem
    if (resp.status === 400 && extras) { extras = false; recusaExtras.add(chaveModelo); continue; }
    if ((resp.status === 429 || resp.status >= 500) && tentativa < 2) { await esperar(1200 * (tentativa + 1)); continue; }
    throw Object.assign(new Error(mensagemErro(resp.status, corpo)), { status: resp.status });
  }
}

function mensagemErro(status, corpo) {
  const detalhe = (() => {
    try { const j = JSON.parse(corpo); return j.error?.message || j.message || corpo; } catch { return corpo; }
  })();
  const motivo = {
    401: "Chave da API inválida", 403: "Sem permissão (chave ou origem bloqueada)", 402: "Sem saldo na conta da API",
    404: "Modelo ou endereço não encontrado", 413: "Imagem grande demais", 429: "Limite de uso da API atingido",
  }[status];
  return motivo ? `${motivo} — ${String(detalhe).slice(0, 160)}` : `API ${status}: ${String(detalhe).slice(0, 200)}`;
}

// O que muda entre chamadas (contexto, texto lido) vai depois da imagem: o começo da mensagem
// (instruções + imagem) fica igual, o que deixa as APIs com cache de prefixo cobrarem menos.
function montar(cfg, { prompt, imagem = null, depois = "" }, extras) {
  const { def, modelo, chave, url } = cfg;
  const base64 = imagem ? imagem.slice(imagem.indexOf(",") + 1) : "";
  if (def.tipo === "gemini") {
    const gc = { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: "application/json" };
    // raciocínio só atrasa: nível mínimo no Gemini 3, orçamento zero no 2.5
    if (/gemini-3/.test(modelo)) gc.thinkingConfig = { thinkingLevel: "minimal" };
    else if (/2\.5-flash/.test(modelo)) gc.thinkingConfig = { thinkingBudget: 0 };
    return {
      url: `${url}/v1beta/models/${encodeURIComponent(modelo)}:streamGenerateContent?alt=sse`,
      headers: { "x-goog-api-key": chave },
      body: {
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            ...(imagem ? [{ inline_data: { mime_type: "image/jpeg", data: base64 } }] : []),
            ...(depois ? [{ text: depois }] : []),
          ],
        }],
        ...(extras && {
          generationConfig: gc,
          // cenas de luta e afins não devem bloquear a tradução
          safetySettings: ["HARASSMENT", "HATE_SPEECH", "SEXUALLY_EXPLICIT", "DANGEROUS_CONTENT"]
            .map((c) => ({ category: `HARM_CATEGORY_${c}`, threshold: "BLOCK_NONE" })),
        }),
      },
    };
  }
  if (def.tipo === "claude") {
    return {
      url: `${url}/v1/messages`,
      headers: {
        "x-api-key": chave, "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: {
        model: modelo, max_tokens: 2048, stream: true, ...(extras && { temperature: 0.2 }),
        messages: [{
          role: "user",
          content: [
            ...(imagem ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } }] : []),
            { type: "text", text: depois ? `${prompt}\n${depois}` : prompt },
          ],
        }],
      },
    };
  }
  return { // compatível com OpenAI
    url: `${url}/chat/completions`,
    headers: chave ? { Authorization: `Bearer ${chave}` } : {},
    body: {
      model: modelo, stream: true,
      ...(extras && { temperature: 0.2, max_tokens: 2048, ...def.extras }),
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...(imagem ? [{ type: "image_url", image_url: { url: imagem, ...(extras && { detail: "high" }) } }] : []),
          ...(depois ? [{ type: "text", text: depois }] : []),
        ],
      }],
    },
  };
}

/** Texto de um evento do stream (ou da resposta inteira, se o servidor ignorar o streaming). */
export function extrair(tipo, j) {
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error).slice(0, 200));
  if (tipo === "gemini") {
    if (j.promptFeedback?.blockReason) throw new Error(`Bloqueado pelo Gemini (${j.promptFeedback.blockReason})`);
    return (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  }
  if (tipo === "claude") {
    if (j.type === "error") throw new Error(j.error?.message || "erro da API");
    if (j.type === "content_block_delta") return j.delta?.text || "";
    return (j.content || []).map((c) => c.text || "").join("");
  }
  const c = j.choices?.[0];
  return c?.delta?.content ?? c?.message?.content ?? "";
}

/** Tokens gastos, quando a API conta (no último evento do stream ou na resposta inteira). */
export function lerUso(tipo, j, uso) {
  const u = tipo === "gemini" ? j.usageMetadata : tipo === "claude" ? (j.message?.usage || j.usage) : j.usage;
  if (!u) return;
  const entrada = u.prompt_tokens ?? u.promptTokenCount ?? u.input_tokens;
  const saida = u.completion_tokens ?? u.candidatesTokenCount ?? u.output_tokens;
  if (entrada) uso.entrada = entrada;
  if (saida) uso.saida = saida;
}

async function ler(resp, tipo, aoTexto, uso) {
  if (!/event-stream/.test(resp.headers.get("content-type") || "")) {
    const j = await resp.json();
    const texto = extrair(tipo, j);
    lerUso(tipo, j, uso);
    aoTexto(texto);
    return texto;
  }
  const leitor = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "", texto = "";
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
      if (!dado || dado === "[DONE]") continue;
      let j;
      try { j = JSON.parse(dado); } catch { continue; }
      lerUso(tipo, j, uso);
      const t = extrair(tipo, j);
      if (t) { texto += t; mudou = true; }
    }
    if (mudou) aoTexto(texto);
  }
  return texto;
}
