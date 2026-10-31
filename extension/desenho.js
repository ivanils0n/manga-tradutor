// Desenha cada balão traduzido num <canvas>. O modo escuro forçado de navegadores de celular (Lemur e
// outros) escurece fundos e letras da página, mas não mexe em canvas: o balão fica com a cor dele.
// O texto é encaixado como no letreiramento de mangá: do tamanho da letra original quando cabe, cada
// linha com a largura do balão naquela altura e sem picar palavra curta. Se mesmo assim não couber,
// vira um balão novo, maior, sem sair da tela. Carregado antes do content.js; testado no Node.

/**
 * Quebra as palavras em linhas. `largura`: px de cada linha (um número, ou uma lista com a largura de
 * cada linha, para acompanhar o formato do balão). Palavra que não cabe: com `partir`, só palavra
 * comprida (7+ letras) é partida com hífen, em pedaços de 3+ letras; senão, não coube (null).
 */
function quebrarLinhas(palavras, largura, medir, partir = false, maxLinhas = Infinity) {
  const larg = (i) => (Array.isArray(largura) ? largura[i] ?? -1 : largura);
  const linhas = [];
  let atual = "";
  for (let p of palavras) {
    const junto = atual ? `${atual} ${p}` : p;
    if (medir(junto) <= larg(linhas.length)) { atual = junto; continue; }
    if (atual) { linhas.push(atual); atual = ""; }
    while (medir(p) > larg(linhas.length)) {
      if (!partir || p.length < 7) return null;
      let k = p.length - 3;
      while (k > 3 && medir(p.slice(0, k) + "-") > larg(linhas.length)) k--;
      if (medir(p.slice(0, k) + "-") > larg(linhas.length)) return null;
      linhas.push(p.slice(0, k) + "-");
      p = p.slice(k);
    }
    atual = p;
  }
  if (atual) linhas.push(atual);
  return linhas.length <= maxLinhas ? linhas : null;
}

/** As mesmas linhas com a menor largura que não aumenta o número delas: texto "redondo", de balão. */
function equilibrar(palavras, linhas, largura, medir, partir = false) {
  const hifens = (ls) => ls.filter((l) => l.endsWith("-")).length;
  let lo = largura / 2, hi = largura, melhor = linhas;
  for (let k = 0; k < 7; k++) {
    const m = (lo + hi) / 2, ls = quebrarLinhas(palavras, m, medir, partir);
    if (ls && ls.length <= linhas.length && hifens(ls) <= hifens(linhas)) { melhor = ls; hi = m; } else lo = m;
  }
  return melhor;
}

/** Maior valor entre min e max em que `cabe(tamanho)` dá certo (busca binária). null se nem o min couber. */
function maiorQueCabe(min, max, cabe) {
  if (!cabe(min)) return null;
  let lo = min, hi = Math.max(min, max);
  if (cabe(hi)) return hi;
  while (hi - lo > 0.5) { const m = (lo + hi) / 2; if (cabe(m)) lo = m; else hi = m; }
  return lo;
}

/**
 * O maior tamanho de letra (entre min e max) em que o texto cabe numa caixa larg×alt, com a margem de
 * dentro do balão (.5em dos lados, .3em em cima e embaixo). Primeiro sem partir palavra nenhuma; só se
 * não der, parte palavra comprida. `medirCom(tamanho)` devolve a função que mede um trecho. null se não couber.
 */
function encaixarTexto(texto, larg, alt, min, max, entrelinha, medirCom) {
  const palavras = String(texto).split(/\s+/).filter(Boolean);
  if (!palavras.length) return null;
  for (const partir of [false, true]) {
    const linhasEm = (s) => {
      const w = larg - s;
      if (w <= 0) return null;
      const ls = quebrarLinhas(palavras, w, medirCom(s), partir);
      return ls && ls.length * s * entrelinha <= alt - 0.6 * s + 0.5 ? ls : null;
    };
    const s = maiorQueCabe(min, max, linhasEm);
    if (s) return { tamanho: s, linhas: equilibrar(palavras, linhasEm(s), larg - s, medirCom(s), partir) };
  }
  return null;
}

/**
 * Encaixa o texto no formato do balão. perfil: { cx, t, b, meia } em px da caixa — meia é a meia-largura
 * livre do balão (medida a partir de cx) em 16 alturas entre t e b. Cada linha ganha a largura do balão
 * na altura dela; o bloco fica centrado no texto original (cy), sem sair do balão. Devolve
 * { tamanho, linhas: [{ texto, x, y }] } com a maior letra entre min e max, ou null.
 */
function encaixarNoBalao(texto, perfil, cy, min, max, entrelinha, medirCom) {
  const palavras = String(texto).split(/\s+/).filter(Boolean);
  const { cx, t, b, meia } = perfil, passo = (b - t) / meia.length;
  if (!palavras.length || !(b - t > 0)) return null;
  const meiaEm = (y0, y1) => { // a menor meia-largura no trecho da linha (fora do balão: 0)
    if (y0 < t - 0.5 || y1 > b + 0.5) return 0;
    let m = Infinity;
    for (let i = Math.max(0, Math.floor((y0 - t) / passo)); i <= Math.min(meia.length - 1, Math.floor((y1 - t) / passo)); i++) m = Math.min(m, meia[i]);
    return m;
  };
  const arrumar = (s) => {
    const medir = medirCom(s), lh = s * entrelinha, folga = 0.25 * s;
    const inicio = (n) => Math.min(Math.max(cy - (n * lh) / 2, t + folga), b - folga - n * lh); // centrado, dentro do balão
    const larguras = (y0, n) => Array.from({ length: n }, (_, i) => 2 * meiaEm(y0 + i * lh, y0 + (i + 1) * lh) - 0.8 * s);
    for (let n = 1; n * lh <= b - t - 2 * folga; n++) {
      const y0 = inicio(n), ws = larguras(y0, n);
      if (ws.some((w) => w < 1.5 * s)) continue; // a linha cairia na ponta do balão
      const ls = quebrarLinhas(palavras, ws, medir, false, n);
      if (!ls) continue;
      // sobrou linha vazia: centraliza o que foi usado, se continuar cabendo
      const y1 = inicio(ls.length), ws1 = larguras(y1, ls.length);
      const y = ls.every((l, i) => medir(l) <= ws1[i]) ? y1 : y0;
      return ls.map((tx, i) => ({ texto: tx, x: cx, y: y + (i + 0.5) * lh }));
    }
    return null;
  };
  const s = maiorQueCabe(min, max, arrumar);
  return s ? { tamanho: s, linhas: arrumar(s) } : null;
}

/** Caixa para a tradução que não coube nem com a letra mínima: vai alargando (até `maxLarg`) enquanto ficar mais alta que larga. */
function caixaExpandida(texto, larg, alt, min, entrelinha, medirCom, maxLarg) {
  const palavras = String(texto).split(/\s+/).filter(Boolean), medir = medirCom(min);
  let w = Math.min(maxLarg, Math.max(larg, 9 * min));
  for (let k = 0; ; k++) {
    const ls = quebrarLinhas(palavras, w - 1.2 * min, medir, true) || [palavras.join(" ")];
    const h = ls.length * min * entrelinha + 0.8 * min;
    if (h <= w || w >= maxLarg || k > 8) {
      return { w, h: Math.max(alt, h), tamanho: min, linhas: equilibrar(palavras, ls, w - 1.2 * min, medir, true) };
    }
    w = Math.min(maxLarg, w * 1.2);
  }
}

/**
 * Pinta o balão traduzido em `cv`, um canvas posicionado em relação à caixa do balão (w×h px).
 * b: { w, h, cobre (onde estava o texto original, px na caixa), areas (retângulos livres dentro do balão),
 * perfil (formato do balão, ver encaixarNoBalao), letra (tamanho da letra original, px), fundo, claro,
 * uniforme, remendo (ImageBitmap), texto, fonte, maiusculas, idioma, minimo, x (onde a caixa está na
 * tela), largTela, escala }.
 */
function pintarBalao(cv, b) {
  const ctx = cv.getContext("2d");
  const familia = b.fonte === "sistema" ? '"Segoe UI", system-ui, sans-serif' : '"MT Quadrinhos", "Comic Sans MS", "Segoe UI", system-ui, sans-serif';
  const entrelinha = b.fonte === "sistema" ? 1.15 : 1.1;
  const medirCom = (s) => { ctx.font = `700 ${s}px ${familia}`; return (t) => ctx.measureText(t).width; };
  const texto = b.maiusculas ? b.texto.toLocaleUpperCase(b.idioma) : b.texto;
  const c = b.cobre;
  const areas = b.areas?.length ? b.areas : [{ l: 0, t: 0, r: b.w, b: b.h }];
  let enc = null, novo = null, bloco = null, dx = 0;
  if (texto) {
    // do tamanho da letra original, se souber; senão o maior que couber (até 30 px)
    const teto = (alt) => (b.letra ? Math.min(48, Math.max(b.minimo, b.letra)) : Math.min(30, alt * 0.42));
    if (b.perfil) enc = encaixarNoBalao(texto, b.perfil, (c.t + c.b) / 2, b.minimo, teto(Infinity), entrelinha, medirCom);
    for (const a of areas) { // retângulos livres do balão (e texto sobre o desenho, que não tem formato)
      const e = encaixarTexto(texto, a.r - a.l, a.b - a.t, b.minimo, teto(a.b - a.t), entrelinha, medirCom);
      if (e && (!enc || e.tamanho > enc.tamanho + 0.5)) enc = { tamanho: e.tamanho, linhas: centrar(e.linhas, a, e.tamanho * entrelinha) };
    }
    if (!enc) { // não coube nem com a letra mínima: balão novo, maior, centrado no original
      const a = areas[0], cx = (a.l + a.r) / 2, cy = (a.t + a.b) / 2;
      const e = caixaExpandida(texto, a.r - a.l, a.b - a.t, b.minimo, entrelinha, medirCom, b.largTela - 12);
      novo = { l: cx - e.w / 2, t: cy - e.h / 2, r: cx + e.w / 2, b: cy + e.h / 2 };
      enc = { tamanho: e.tamanho, linhas: centrar(e.linhas, novo, e.tamanho * entrelinha) };
    }
    // onde o texto fica (px da caixa); e ele nunca sai da tela pelos lados (o balão pode estar na beirada)
    const medir = medirCom(enc.tamanho), mg = 0.3 * enc.tamanho, lh = enc.tamanho * entrelinha;
    bloco = novo ? { ...novo } : { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
    for (const ln of enc.linhas) {
      const m = medir(ln.texto) / 2 + mg;
      Object.assign(bloco, { l: Math.min(bloco.l, ln.x - m), r: Math.max(bloco.r, ln.x + m), t: Math.min(bloco.t, ln.y - lh / 2), b: Math.max(bloco.b, ln.y + lh / 2) });
    }
    const esq = b.x + bloco.l, dir = b.x + bloco.r;
    dx = esq < 6 ? 6 - esq : dir > b.largTela - 6 ? Math.max(6 - esq, b.largTela - 6 - dir) : 0;
    bloco.l += dx; bloco.r += dx;
    if (novo) { novo.l += dx; novo.r += dx; }
  }

  // o canvas cobre a caixa, a parte apagada, o texto e o balão novo, com folga para a borda esfumada e a
  // sombra; e nunca passa das bordas da tela: senão a página fica mais larga (no celular ela encolhe)
  const folga = 12, k = b.escala;
  let l = Math.min(0, c.l), t = Math.min(0, c.t), r = Math.max(b.w, c.r), fim = Math.max(b.h, c.b);
  if (bloco) { l = Math.min(l, bloco.l); t = Math.min(t, bloco.t); r = Math.max(r, bloco.r); fim = Math.max(fim, bloco.b); }
  l = Math.max(-b.x, l - folga); t -= folga;
  r = Math.max(l + 1, Math.min(b.largTela - b.x, r + folga)); fim += folga;
  cv.width = Math.max(1, Math.round((r - l) * k));
  cv.height = Math.max(1, Math.round((fim - t) * k));
  Object.assign(cv.style, { left: l + "px", top: t + "px", width: r - l + "px", height: fim - t + "px" });
  ctx.setTransform(k, 0, 0, k, -l * k, -t * k);
  const caminho = (x0, y0, x1, y1, raio) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, x1 - x0, y1 - y0, raio); else ctx.rect(x0, y0, x1 - x0, y1 - y0);
  };

  // 1) apaga o texto original
  ctx.save();
  if (b.remendo) { // fundo reconstruído (texto escrito sobre cor lisa ou degradê)
    caminho(c.l, c.t, c.r, c.b, 6);
    ctx.clip();
    ctx.drawImage(b.remendo, c.l, c.t, c.r - c.l, c.b - c.t);
  } else if (b.uniforme) { // cor do balão, com a borda esfumada (não fica um "recorte" visível)
    ctx.fillStyle = ctx.shadowColor = b.fundo;
    ctx.shadowBlur = 5;
    caminho(c.l - 3, c.t - 3, c.r + 3, c.b + 3, 10);
    ctx.fill();
  } else { // sobre o desenho: caixa lisa da cor de fundo (sem borrar o desenho em volta)
    ctx.fillStyle = b.fundo + "f0";
    ctx.shadowColor = "#0004";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;
    caminho(0, 0, b.w, b.h, 10);
    ctx.fill();
  }
  ctx.restore();
  if (!enc) return;

  // 2) não coube: balão novo por cima, com contorno de balão
  if (novo) {
    const raio = Math.min(18, (novo.b - novo.t) / 2);
    ctx.save();
    ctx.fillStyle = b.fundo;
    ctx.shadowColor = "#0005";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    caminho(novo.l, novo.t, novo.r, novo.b, raio);
    ctx.fill();
    ctx.restore();
    if (b.uniforme) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = b.claro ? "#16130f" : "#fbf8f1";
      caminho(novo.l + 1, novo.t + 1, novo.r - 1, novo.b - 1, raio);
      ctx.stroke();
    }
  }

  // 3) a tradução
  ctx.font = `700 ${enc.tamanho}px ${familia}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = b.claro ? "#16130f" : "#fff";
  const contorno = !b.uniforme && !novo; // sobre o desenho: contorno da cor do fundo para ler bem
  if (contorno) { ctx.shadowColor = b.fundo; ctx.shadowBlur = 3; }
  for (const ln of enc.linhas) {
    ctx.fillText(ln.texto, ln.x + dx, ln.y);
    if (contorno) ctx.fillText(ln.texto, ln.x + dx, ln.y);
  }
}

/** Linhas centradas num retângulo: [{ texto, x, y }]. */
function centrar(linhas, a, lh) {
  const cx = (a.l + a.r) / 2, y0 = (a.t + a.b) / 2 - ((linhas.length - 1) * lh) / 2;
  return linhas.map((texto, i) => ({ texto, x: cx, y: y0 + i * lh }));
}
