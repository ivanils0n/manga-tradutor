// Desenha cada balão traduzido num <canvas>. O modo escuro forçado de navegadores de celular (Lemur e
// outros) escurece fundos e letras da página, mas não mexe em canvas: o balão fica com a cor dele.
// Também escolhe o tamanho da letra e, se a tradução não couber, desenha um balão novo, maior, sem
// sair da tela. Carregado antes do content.js; as funções de texto são testadas no Node.

/** Quebra as palavras em linhas de até `largura` px (`medir` dá a largura de um trecho). Palavra maior que a linha é partida com hífen. */
function quebrarLinhas(palavras, largura, medir) {
  const linhas = [];
  let atual = "";
  for (let p of palavras) {
    const junto = atual ? `${atual} ${p}` : p;
    if (medir(junto) <= largura) { atual = junto; continue; }
    if (atual) linhas.push(atual);
    while (p.length > 1 && medir(p) > largura) {
      let k = p.length - 1;
      while (k > 1 && medir(p.slice(0, k) + "-") > largura) k--;
      linhas.push(p.slice(0, k) + "-");
      p = p.slice(k);
    }
    atual = p;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/** As mesmas linhas com a menor largura que não aumenta o número delas: texto "redondo", de balão. */
function equilibrar(palavras, linhas, largura, medir) {
  const hifens = (ls) => ls.filter((l) => l.endsWith("-")).length;
  let lo = largura / 2, hi = largura, melhor = linhas;
  for (let k = 0; k < 7; k++) {
    const m = (lo + hi) / 2, ls = quebrarLinhas(palavras, m, medir);
    if (ls.length <= linhas.length && hifens(ls) <= hifens(linhas)) { melhor = ls; hi = m; } else lo = m;
  }
  return melhor;
}

/**
 * O maior tamanho de letra (entre min e max) em que o texto cabe numa caixa larg×alt, com a margem de
 * dentro do balão (.5em dos lados, .3em em cima e embaixo). `medirCom(tamanho)` devolve a função que
 * mede um trecho nesse tamanho. null se nem a letra mínima couber.
 */
function encaixarTexto(texto, larg, alt, min, max, entrelinha, medirCom) {
  const palavras = String(texto).split(/\s+/).filter(Boolean);
  const linhasEm = (s) => {
    const medir = medirCom(s), w = larg - s;
    if (w <= 0) return null;
    const ls = quebrarLinhas(palavras, w, medir);
    return ls.length * s * entrelinha <= alt - 0.6 * s + 0.5 && ls.every((l) => medir(l) <= w + 0.5) ? ls : null;
  };
  if (!palavras.length || !linhasEm(min)) return null;
  let lo = min, hi = Math.max(min, max);
  if (linhasEm(hi)) lo = hi;
  else while (hi - lo > 0.5) { const m = (lo + hi) / 2; if (linhasEm(m)) lo = m; else hi = m; }
  return { tamanho: lo, linhas: equilibrar(palavras, linhasEm(lo), larg - lo, medirCom(lo)) };
}

/** Caixa para a tradução que não coube nem com a letra mínima: vai alargando (até `maxLarg`) enquanto ficar mais alta que larga. */
function caixaExpandida(texto, larg, alt, min, entrelinha, medirCom, maxLarg) {
  const palavras = String(texto).split(/\s+/).filter(Boolean), medir = medirCom(min);
  let w = Math.min(maxLarg, Math.max(larg, 9 * min));
  for (let k = 0; ; k++) {
    const ls = quebrarLinhas(palavras, w - 1.2 * min, medir);
    const h = ls.length * min * entrelinha + 0.8 * min;
    if (h <= w || w >= maxLarg || k > 8) {
      return { w, h: Math.max(alt, h), tamanho: min, linhas: equilibrar(palavras, ls, w - 1.2 * min, medir) };
    }
    w = Math.min(maxLarg, w * 1.2);
  }
}

/**
 * Pinta o balão traduzido em `cv`, um canvas posicionado em relação à caixa do balão (w×h px).
 * b: { w, h, cobre (onde estava o texto original, px na caixa), areas (onde a tradução pode ir dentro do
 * balão: o espaço largo e o alto), fundo, claro, uniforme, remendo (ImageBitmap), texto, fonte, maiusculas,
 * idioma, minimo, x (onde a caixa está na tela), largTela, escala }.
 */
function pintarBalao(cv, b) {
  const ctx = cv.getContext("2d");
  const familia = b.fonte === "sistema" ? '"Segoe UI", system-ui, sans-serif' : '"MT Quadrinhos", "Comic Sans MS", "Segoe UI", system-ui, sans-serif';
  const entrelinha = b.fonte === "sistema" ? 1.15 : 1.1;
  const medirCom = (s) => { ctx.font = `700 ${s}px ${familia}`; return (t) => ctx.measureText(t).width; };
  const texto = b.maiusculas ? b.texto.toLocaleUpperCase(b.idioma) : b.texto;
  const areas = b.areas?.length ? b.areas : [{ l: 0, t: 0, r: b.w, b: b.h }];
  const caixa = { ...areas[0] };
  let enc = null, novo = false;
  if (texto) {
    for (const a of areas) { // o espaço do balão que dá a letra maior
      const e = encaixarTexto(texto, a.r - a.l, a.b - a.t, b.minimo, Math.min(30, (a.b - a.t) * 0.42), entrelinha, medirCom);
      if (e && (!enc || e.tamanho > enc.tamanho + 0.5)) { enc = e; Object.assign(caixa, a); }
    }
    if (!enc) { // não coube nem com a letra mínima: balão novo, maior, centrado no original
      const a = areas[0], cx = (a.l + a.r) / 2, cy = (a.t + a.b) / 2;
      enc = caixaExpandida(texto, a.r - a.l, a.b - a.t, b.minimo, entrelinha, medirCom, b.largTela - 12);
      Object.assign(caixa, { l: cx - enc.w / 2, t: cy - enc.h / 2, r: cx + enc.w / 2, b: cy + enc.h / 2 });
      novo = true;
    }
    // a tradução nunca sai da tela pelos lados (o balão original pode estar na beirada)
    const esq = b.x + caixa.l, dir = b.x + caixa.r;
    const dx = esq < 6 ? 6 - esq : dir > b.largTela - 6 ? Math.max(6 - esq, b.largTela - 6 - dir) : 0;
    caixa.l += dx; caixa.r += dx;
  }

  // o canvas cobre a caixa, a parte apagada e a tradução, com folga para a borda esfumada e a sombra
  // e nunca passa das bordas da tela: senão a página fica mais larga (no celular ela encolhe para caber)
  const c = b.cobre, folga = 12, k = b.escala;
  const l = Math.max(-b.x, Math.min(0, c.l, caixa.l) - folga), t = Math.min(0, c.t, caixa.t) - folga;
  const r = Math.max(l + 1, Math.min(b.largTela - b.x, Math.max(b.w, c.r, caixa.r) + folga)), fim = Math.max(b.h, c.b, caixa.b) + folga;
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
  if (b.remendo) { // fundo reconstruído (texto escrito sobre o desenho)
    caminho(c.l, c.t, c.r, c.b, 6);
    ctx.clip();
    ctx.drawImage(b.remendo, c.l, c.t, c.r - c.l, c.b - c.t);
  } else if (b.uniforme) { // cor do balão, com a borda esfumada (não fica um "recorte" visível)
    ctx.fillStyle = ctx.shadowColor = b.fundo;
    ctx.shadowBlur = 5;
    caminho(c.l - 3, c.t - 3, c.r + 3, c.b + 3, 10);
    ctx.fill();
  } else { // sobre o desenho, sem fundo reconstruído: caixa quase opaca da cor de fundo
    ctx.fillStyle = b.fundo + "e6";
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
    const raio = Math.min(18, (caixa.b - caixa.t) / 2);
    ctx.save();
    ctx.fillStyle = b.fundo;
    ctx.shadowColor = "#0005";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    caminho(caixa.l, caixa.t, caixa.r, caixa.b, raio);
    ctx.fill();
    ctx.restore();
    if (b.uniforme) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = b.claro ? "#16130f" : "#fbf8f1";
      caminho(caixa.l + 1, caixa.t + 1, caixa.r - 1, caixa.b - 1, raio);
      ctx.stroke();
    }
  }

  // 3) a tradução, centrada
  const s = enc.tamanho, lh = s * entrelinha, cx = (caixa.l + caixa.r) / 2;
  let y = (caixa.t + caixa.b) / 2 - ((enc.linhas.length - 1) * lh) / 2;
  ctx.font = `700 ${s}px ${familia}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = b.claro ? "#16130f" : "#fff";
  const contorno = !b.uniforme && !novo; // sobre o desenho: contorno da cor do fundo para ler bem
  if (contorno) { ctx.shadowColor = b.fundo; ctx.shadowBlur = 3; }
  for (const linha of enc.linhas) {
    ctx.fillText(linha, cx, y);
    if (contorno) ctx.fillText(linha, cx, y);
    y += lh;
  }
}
