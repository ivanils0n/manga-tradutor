# Manga Tradutor

Traduz os balões de mangá para português usando a API da DeepSeek.

| Pasta | O que é | Download |
|---|---|---|
| `android/` | App Android com botão flutuante | Releases → **Android – última versão** → `manga-tradutor.apk` |
| `extension/` | Extensão para Chrome/Edge no PC | Releases → **Extensão – última versão** → `manga-tradutor-extensao.zip` |

Cada push na `main` gera de novo só a parte que mudou.

## Android
1. Baixe o APK no celular e instale (instala por cima do anterior).
2. Abra o app, cole a chave da DeepSeek e ligue **Botão flutuante**.
3. Na primeira vez, ative **Manga Tradutor** em Acessibilidade (é por ela que o print é tirado, sem aviso de gravação).
4. No app de mangá, toque no **PT**. Toque na tradução para fechar.
5. Segure o **PT** (vibra) para abrir o menu: traduzir ou desativar o botão. Arraste para mover.

## Extensão (PC)
1. Baixe e extraia o `.zip` numa pasta fixa.
2. Abra `chrome://extensions` (ou `edge://extensions`), ligue **Modo do desenvolvedor** e clique em **Carregar sem compactação**, escolhendo a pasta. Depois de atualizar, clique em ↻ na extensão e recarregue as abas abertas.
3. Clique no ícone → **Configurações**: escolha a IA (DeepSeek, Gemini, OpenAI, Claude, OpenRouter, Ollama ou outra compatível com OpenAI), cole a chave e use **Testar conexão**.
4. Na página do mangá:
   - **T** traduz o que está na tela; **R** recorta só uma parte (sempre pela IA com imagem, o modo caprichado); **O** mostra/oculta as traduções. Dá para trocar por qualquer tecla, combinação ou botão do mouse.
   - As traduções ficam na página até você tirar: **botão direito** no balão → remover (ou remover todos). Clique simples mostra o original. O menu também funciona pelo teclado (setas e Enter).
   - Os balões são cobertos com a cor do próprio balão assim que aparecem, e a tradução entra por cima conforme chega. Texto escrito sobre o desenho ganha um fundo reconstruído. Se o balão for pequeno demais, a tradução ganha uma caixa um pouco maior para continuar legível.
5. No ícone, **Neste site**:
   - **Traduzir ao rolar** traduz a tela e já adianta as páginas que o site carregou mais abaixo (quantas, nas configurações).
   - **Páginas em inglês**: o próprio PC lê o texto (Tesseract) e a IA só corrige e traduz, sem receber a imagem: mais rápido e cerca de metade do custo. Se a leitura sair ruim (letra borrada, desenhada), aquela página vai pela IA com imagem sozinha.
   - **Atalhos de uma tecla**: desligue no site cujos atalhos brigarem com os da extensão.
6. Quando sair versão nova, o popup avisa com um link para baixar.

### Como funciona
- Cada página de mangá é traduzida a partir da própria imagem (baixada com o Referer do site), não de um print: não depende da rolagem e dá para traduzir páginas que ainda não apareceram. Canvas e imagens que o site não deixa baixar vão por print.
- Páginas de até ~1280 px vão inteiras numa chamada; maiores são cortadas em pedaços, em paralelo e em streaming. Partes em branco não vão para a API. No modo inglês, as páginas adiantadas vão juntas numa chamada só.
- Cada tradução fica guardada no navegador pelo endereço da imagem e pelo conteúdo do arquivo, valendo para qualquer IA: voltar a uma página, recarregar, trocar de API ou o site mudar o endereço da imagem não gasta tokens de novo e aparece na hora. Passando de 20.000 pedaços, os mais antigos saem sozinhos.
- **Glossário automático:** a IA anota nomes de personagens, lugares e golpes de cada obra, e eles passam a sair sempre iguais. Dá para ver e apagar nas configurações. As últimas falas também vão junto como contexto.
- A IA devolve a caixa do texto e a tradução num JSON compacto. A extensão confere a caixa na própria imagem (corrige caixas tortas ou folgadas), mede a cor do balão e até onde ele vai, e encaixa a tradução no espaço do balão.
- **Uso:** as configurações mostram chamadas, tokens e quanto o cache e a leitura no PC economizaram.
- Tesseract (núcleo WebAssembly e modelo de inglês): licença Apache 2.0, em `extension/tesseract/`.
