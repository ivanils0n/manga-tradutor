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
   - **T** traduz o que está na tela; **R** recorta só uma parte; **O** mostra/oculta as traduções (dá para trocar por qualquer tecla, combinação ou botão do mouse).
   - As traduções ficam na página até você tirar: **botão direito** no balão → remover (ou remover todos). Clique simples mostra o original.
   - Os balões são cobertos com a cor do próprio balão assim que aparecem, e a tradução entra por cima conforme chega. Se o balão for pequeno demais, a tradução ganha uma caixa um pouco maior para continuar legível.
   - **Traduzir ao rolar** (no ícone) traduz a tela e já adianta as páginas que o site carregou mais abaixo (quantas, nas configurações).

### Como funciona
- Cada página de mangá é traduzida a partir da própria imagem (baixada com o Referer do site), não de um print: não depende da rolagem e dá para traduzir páginas que ainda não apareceram. Canvas e imagens que o site não deixa baixar vão por print.
- Páginas de até ~1280 px vão inteiras numa chamada; maiores são cortadas em pedaços, em paralelo e em streaming. Partes em branco não vão para a API.
- Cada tradução fica guardada no navegador pelo endereço da imagem, valendo para qualquer IA: voltar a uma página, recarregar ou trocar de API não gasta tokens de novo.
- As últimas falas vão junto como contexto, para nomes e tom ficarem coerentes entre páginas.
- A IA devolve a caixa do texto original e a tradução num JSON compacto. A extensão mede a cor do balão e até onde ele vai, e encaixa a tradução no espaço do balão.
