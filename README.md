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
2. Abra `chrome://extensions` (ou `edge://extensions`), ligue **Modo do desenvolvedor** e clique em **Carregar sem compactação**, escolhendo a pasta.
3. Clique no ícone da extensão → **Configurações**, cole a chave da DeepSeek e escolha os atalhos (uma tecla ou uma combinação, ex.: `F2` ou `Ctrl + Shift + Q`). Padrão: **Alt + T** traduz a página, **Alt + R** recorta uma parte.
4. Os balões aparecem cobertos de branco assim que são encontrados, e a tradução entra por cima conforme chega. Clique num balão (ou **Esc**) para fechar.
5. Depois de instalar ou atualizar, recarregue as abas que já estavam abertas.
