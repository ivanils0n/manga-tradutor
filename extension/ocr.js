// Ponte entre o background e o worker do Tesseract: recebe a imagem, devolve o TSV com o que foi lido.
let worker = null, proximo = 0;
const esperando = new Map();

function iniciar() {
  worker = new Worker("ocr-worker.js");
  worker.onmessage = ({ data }) => {
    esperando.get(data.id)?.(data);
    esperando.delete(data.id);
  };
  worker.onerror = (e) => {
    for (const responder of esperando.values()) responder({ erro: e.message || "falha no Tesseract" });
    esperando.clear();
    worker = null; // a próxima leitura sobe um worker novo
  };
}

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (msg.alvo !== "ocr") return;
  if (!worker) iniciar();
  const id = ++proximo;
  esperando.set(id, responder);
  worker.postMessage({ id, imagem: msg.imagem });
  return true;
});
