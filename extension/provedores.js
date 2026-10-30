// Chamada em streaming para cada tipo de API. Devolve o texto completo e avisa cada pedaço em aoTexto.

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function chamar(cfg, imagem, prompt, aoTexto = () => {}, sinal) {
  const base64 = imagem.slice(imagem.indexOf(",") + 1);
  let extras = true;
  for (let tentativa = 0; ; tentativa++) {
    const req = montar(cfg, imagem, base64, prompt, extras);
    const resp = await fetch(req.url, {
      method: "POST", headers: { "Content-Type": "application/json", ...req.headers },
      body: JSON.stringify(req.body), signal: sinal,
    });
    if (resp.ok) return ler(resp, cfg.def.tipo, aoTexto);
    const corpo = (await resp.text()).slice(0, 400);
    // parâmetro opcional (temperatura, modo JSON, raciocínio…) que este modelo não aceita: tenta sem
    if (resp.status === 400 && extras) { extras = false; continue; }
    if ((resp.status === 429 || resp.status >= 500) && tentativa < 2) { await esperar(1200 * (tentativa + 1)); continue; }
    throw new Error(mensagemErro(resp.status, corpo));
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

function montar(cfg, imagem, base64, prompt, extras) {
  const { def, modelo, chave, url } = cfg;
  if (def.tipo === "gemini") {
    const gc = { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: "application/json" };
    // raciocínio só atrasa: nível mínimo no Gemini 3, orçamento zero no 2.5
    if (/gemini-3/.test(modelo)) gc.thinkingConfig = { thinkingLevel: "minimal" };
    else if (/2\.5-flash/.test(modelo)) gc.thinkingConfig = { thinkingBudget: 0 };
    return {
      url: `${url}/v1beta/models/${encodeURIComponent(modelo)}:streamGenerateContent?alt=sse`,
      headers: { "x-goog-api-key": chave },
      body: {
        contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: base64 } }] }],
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
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
            { type: "text", text: prompt },
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
          { type: "image_url", image_url: { url: imagem, ...(extras && { detail: "high" }) } },
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

async function ler(resp, tipo, aoTexto) {
  if (!/event-stream/.test(resp.headers.get("content-type") || "")) {
    const texto = extrair(tipo, await resp.json());
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
      const t = extrair(tipo, j);
      if (t) { texto += t; mudou = true; }
    }
    if (mudou) aoTexto(texto);
  }
  return texto;
}
