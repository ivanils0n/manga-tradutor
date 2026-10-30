// Tesseract (núcleo WebAssembly, só LSTM, com SIMD) lendo inglês. Carrega uma vez e atende uma página por vez.
importScripts("tesseract/tesseract-core-simd-lstm.js");

let pronto = null;
function carregar() {
  return (pronto ??= (async () => {
    const M = await TesseractCore({ locateFile: (f) => `tesseract/${f}` });
    const modelo = new Uint8Array(await (await fetch("tesseract/eng.traineddata")).arrayBuffer());
    M.FS.writeFile("eng.traineddata", modelo);
    const api = new M.TessBaseAPI();
    if (api.Init(null, "eng", 1, null) !== 0) throw new Error("não consegui iniciar o Tesseract");
    api.SetVariable("tessedit_pageseg_mode", "11"); // texto esparso: falas espalhadas pela página
    return { M, api };
  })());
}

onmessage = async ({ data }) => {
  try {
    const { M, api } = await carregar();
    const bytes = Uint8Array.from(atob(data.imagem.slice(data.imagem.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    M.FS.writeFile("/input", bytes);
    if (api.SetImageFile(1, 0) === 1) throw new Error("imagem ilegível para o Tesseract");
    api.Recognize(null);
    postMessage({ id: data.id, tsv: api.GetTSVText(0) });
  } catch (e) {
    postMessage({ id: data.id, erro: e.message || String(e) });
  }
};
