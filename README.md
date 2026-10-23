# gallery-stashapp

Plugin de interface para mostrar **fotos e vídeos juntos na grade de uma galeria do Stash**, usando automaticamente os vídeos indexados na mesma pasta.

Não é necessário selecionar cenas, vinculá-las à galeria, abrir outra aba ou recompilar o Stash. Os vídeos continuam sendo cenas **internamente**, mas aparecem e podem ser reproduzidos na própria grade da galeria.

## Como funciona

Para uma galeria baseada nesta pasta:

```text
/colecao/viagem/
├── foto01.jpg
├── video01.mp4
├── foto02.jpg
└── video02.mp4
```

A grade passa a mostrar:

```text
[ foto01.jpg ] [ video01.mp4 ▶ ] [ foto02.jpg ] [ video02.mp4 ▶ ]
```

- Mantém as imagens que já pertencem à galeria.
- Consulta os vídeos da **pasta exata** da galeria, por ID de pasta; não usa comparação parcial de caminhos nem inclui subpastas.
- A consulta não grava associações nem altera metadados e não acessa diretamente o banco ou os arquivos do servidor.
- Reutiliza os **cards, mural e paginação originais** do Stash; permite mudar o tamanho das miniaturas.
- Abre fotos e vídeos no **lightbox nativo**, com as setas na tela e as teclas **← / →**, inclusive entre páginas. **Esc** fecha o visualizador.
- Mantém os controles originais das fotos: zoom, configurações, avaliação e demais ações disponíveis na versão do Stash. Ações que você executar nessas ferramentas continuam alterando os dados normalmente.
- Nos vídeos, habilita os controles HTML5 e o seletor de streams, sem substituir o visualizador das fotos.
- Vídeos não recebem IDs de imagens: avaliação, exclusão e atalhos de imagens não são aplicados a cenas.
- Oferece busca, filtro por tipo e ordenação natural por caminho/título na lista mista.
- Mantém o botão **Ferramentas originais**, para seleção, filtros avançados, edição em lote, capas e remoção na galeria nativa.

A aba nativa pode continuar se chamando **Images/Imagens**. Seu conteúdo recebe a grade mista; o plugin não adiciona uma aba de cenas.

## Requisitos e compatibilidade

- Stash com `PluginApi.patch.instead`/`after`, os pontos de extensão **`GalleryImagesPanel`**, **`ImageList`**, **`ImageCard`**, **`ImageCard.Image`**, os componentes nativos de paginação e ReactDOM/Apollo expostos pela API de plugins.
- Uma galeria **baseada em pasta** (`Gallery.folder`). Galerias ZIP e galerias sem pasta física mantêm a interface original.
- Os vídeos precisam ter sido indexados pelo scan do Stash. Confira se a pasta da biblioteca não está configurada para excluir vídeos.
- A API GraphQL deve oferecer `Image.visual_files`, `SceneFilterType.files_filter`, `FileFilterType.parent_folder` e `Scene.sceneStreams`.

**Referências verificadas:** Stash **v0.31.1** e branch `develop`, commit `bdee3c8`. O ponto de extensão foi conferido no código da versão estável e as consultas foram validadas contra os dois schemas GraphQL. A interface tem testes automatizados com React 17 e uma API de host simulada; a reprodução real e a integração com a versão instalada ainda precisam ser testadas no seu Stash. Não há garantia de compatibilidade com todas as versões ou com outros plugins que substituam a mesma grade.

O plugin usa a API de interface experimental do Stash; atualizações podem exigir ajustes. Como o lightbox não expõe um ponto de extensão específico para controles de vídeo, uma integração de DOM limitada às mídias do plugin habilita esses controles e pausa o vídeo ao sair dele. A renderização e as ações das fotos permanecem nativas. Ao abrir uma galeria, você pode verificar o ponto de extensão no console do navegador:

```js
typeof window.PluginApi?.components?.GalleryImagesPanel
// Esperado: "function"
```

Se retornar `undefined` depois de a galeria carregar, essa versão não expõe o componente esperado. Desabilite o plugin e informe a versão do Stash para adaptar a integração.

## Instalação pela interface do Stash (recomendada)

Em **Settings → Plugins → Available Plugins**, adicione uma fonte com:

- **Nome:** `Gallery Stashapp`
- **URL:** `https://raw.githubusercontent.com/fbsis/gallery-stashapp/main/index.yml`
- **Local Path:** `gallery-stashapp`

Atualize a lista, selecione **Gallery Stashapp - Fotos e vídeos** e instale. Depois, recarregue completamente o navegador (`Cmd+Shift+R` / `Ctrl+Shift+R`) e abra uma galeria baseada em pasta.

**Não use a URL da página do GitHub, do README ou de `gallery-stashapp.yml` como fonte.** O Stash espera um índice de pacotes (`index.yml`), que aponta para um ZIP e seu SHA-256. Uma URL de página HTML pode causar o erro `reading package list: yaml: ... mapping values are not allowed in this context`.

Se já cadastrou uma fonte com erro, remova-a ou corrija sua URL antes de atualizar a lista. Se já fez a instalação manual, remova primeiro aquela cópia para não carregar o plugin duas vezes.

## Instalação manual — sem build e sem Node.js

Use o diretório `plugins` **ao lado do `config.yml` utilizado pelo seu Stash**. O caminho padrão costuma ser `~/.stash/plugins`, mas pode ser outro, principalmente em Docker.

Copie estes quatro arquivos, mantendo-os juntos:

```text
plugins/
└── gallery-stashapp/
    ├── gallery-stashapp.yml
    ├── gallery-core.js
    ├── gallery-stashapp.js
    └── gallery-stashapp.css
```

Exemplo no macOS/Linux, a partir da raiz deste repositório:

```bash
mkdir -p "$HOME/.stash/plugins/gallery-stashapp"
cp gallery-stashapp.yml gallery-core.js gallery-stashapp.js gallery-stashapp.css \
  "$HOME/.stash/plugins/gallery-stashapp/"
```

Se o Stash está em Docker, copie para o diretório de configuração montado no container, por exemplo `<config-do-host>/plugins/gallery-stashapp/`. Não copie os arquivos para uma pasta de mídia.

Depois:

1. Abra **Settings → Plugins**.
2. Clique em **Reload Plugins** e habilite **Gallery Stashapp - Fotos e vídeos**, se necessário.
3. Recarregue completamente a página do navegador (`Cmd+Shift+R` / `Ctrl+Shift+R`). Recarregar a lista de plugins sozinho não substitui JavaScript que já está executando.
4. Abra uma galeria baseada em pasta.
5. Na grade **Fotos e vídeos**, os vídeos da pasta aparecerão automaticamente.

Não é preciso instalar as dependências de desenvolvimento para utilizar o plugin.

## Atualização e remoção

Se instalou pela interface, use o gerenciador de plugins do Stash para verificar e instalar atualizações. Na instalação manual, substitua os quatro arquivos e recarregue os plugins. Nos dois casos, recarregue a página completamente.

Para remover, desabilite o plugin ou remova a pasta `gallery-stashapp` do diretório de plugins, recarregue os plugins e a página. Como não existem alterações no banco, não há migração ou limpeza de vínculos.

## Limites atuais

- Não cria galerias novas para pastas que só tenham vídeos; melhora a visualização de galerias de pasta que já existem.
- Não inclui vídeos de subpastas, ZIPs ou arquivos que ainda não foram indexados.
- Os dados são recarregados ao abrir a grade ou clicar em **Atualizar**. Se executar um scan com a galeria aberta, clique nesse botão depois.
- Busca e ordenação são locais: as mídias são consultadas em lotes de 250 registros, e só a página visível renderiza miniaturas. Galerias muito grandes ainda precisam carregar seus metadados completos para ordenar e paginar fotos e vídeos juntos.
- O visualizador usa o player HTML5 do navegador. MP4/WebM e outros formatos dependem do navegador e da configuração de streaming/FFmpeg do Stash. HLS/DASH não recebem uma biblioteca adicional de reprodução; selecione um stream compatível quando necessário.
- O lightbox e seu slideshow são os originais do Stash. No modo misto, os capítulos são omitidos porque os índices dos capítulos originais contam somente imagens. O slideshow continua usando o intervalo nativo, não a duração dos vídeos.
- Não implementa os recursos avançados do player de cenas, contagem de reprodução ou histórico de progresso de vídeos. O Stash pode gerar/transcodificar mídia ao atender streams, conforme sua configuração.
- Se uma cena possui múltiplos arquivos/versões, basta um arquivo estar na pasta para aparecer; a reprodução usa a versão escolhida pelo próprio Stash.
- O modo misto é somente de visualização na grade (sem seleção em lote), mas mantém as ações nativas disponíveis nas fotos dentro do lightbox. A lista é atualizada ao fechar esse visualizador para refletir alterações.
- A barra de busca/filtros da lista mista não é a barra completa de filtros avançados do Stash. As operações nativas de seleção, filtros avançados, edição em lote, definição de capa e remoção permanecem disponíveis em **Ferramentas originais**.

## Diagnóstico

**O plugin não aparece em Settings → Plugins:** confira se a pasta está no diretório de configuração correto e se o `.yml` foi copiado.

**A grade continua igual:** faça uma recarga completa, confira se customizações de interface não estão desabilitadas e procure mensagens `[gallery-stashapp]` no console. Verifique o ponto de extensão citado na seção de compatibilidade.

**Aparecem somente fotos:** confira se a galeria é baseada em pasta e se os vídeos foram indexados nessa pasta exata, sem exclusões. Clique em **Atualizar** depois do scan.

**Erro de GraphQL/campo desconhecido:** use **Ferramentas originais** e informe a versão do Stash e a mensagem exibida. A versão instalada pode não oferecer o schema esperado.

**Vídeo não reproduz:** tente outro stream no seletor do rodapé; confira FFmpeg e streaming nas configurações do Stash. As teclas ←/→ continuam navegando entre as mídias; use os controles do vídeo para avançar dentro dele.

## Desenvolvimento e testes

Node.js 20+ é necessário apenas para desenvolver e testar:

```bash
npm ci
npm run check
npm test
```

Os testes cobrem consulta paginada, seleção da pasta exata, mídia mista, ordenação, filtros, cancelamento, troca de galeria, erros, retorno à interface original, integração com os componentes nativos e navegação foto → vídeo → foto por teclado/setas, incluindo troca de página. Também verificam que IDs de cenas nunca são fornecidos às ações de imagens. O host de interface é simulado nos testes; zoom, gestos, reprodução e foco devem ser conferidos no navegador com o Stash real.

Para validar também as consultas contra um checkout do schema do Stash:

```bash
STASH_SCHEMA_DIR=/caminho/stash/graphql/schema npm test
```

Se existir um checkout em `../stash`, ele será usado automaticamente. Sem um schema local e sem a variável acima, apenas esse teste é marcado como ignorado. O CI executa os testes contra os schemas da versão `v0.31.1` e da branch `develop`.

### Publicar um pacote instalável

Depois de alterar o plugin:

1. Atualize a versão em `package.json`/`package-lock.json` e em `gallery-stashapp.yml`.
2. Atualize `RELEASE_DATE` em `scripts/package.cjs` (UTC, formato `YYYY-MM-DD HH:mm:ss`). O Stash compara essa data ao procurar atualizações.
3. Execute `npm run package` e `npm test`.
4. Faça commit de `index.yml`, do ZIP gerado em `dist/` e das alterações de código, e envie para `main`.

O pacote é reproduzível, inclui somente os arquivos de execução e a licença e possui nome baseado em versão e hash. Mantenha ZIPs de releases anteriores disponíveis: um índice em cache pode ainda apontar para eles. A fonte de instalação continua sendo a mesma URL de `index.yml`.

### Roteiro de teste manual

1. Use uma galeria de teste com pelo menos uma foto e um vídeo na mesma pasta.
2. Indexe a pasta, abra a galeria e confira fotos e vídeos na mesma grade.
3. Verifique que um vídeo de uma subpasta não aparece.
4. Abra uma foto: confira o lightbox original, seu zoom, configurações e ações de imagem.
5. Use ←/→ e as setas da tela para navegar foto → vídeo → foto, inclusive entre páginas. Nos vídeos, confira os controles, o stream e que não existem ações de excluir/avaliar imagem; o vídeo deve pausar ao sair dele.
6. Teste **Esc**, grade/mural, tamanho das miniaturas, busca, tipos, ordenação, paginação e **Ferramentas originais**.
7. Execute um scan com mídia nova e clique em **Atualizar**.
8. Abra uma galeria ZIP: ela deve manter a interface original.
9. Desabilite o plugin e recarregue a página: a interface original deve voltar sem mudanças nos dados (exceto alterações que você tenha feito voluntariamente nas ações nativas).

## Licença

MIT. Projeto independente, não oficial do Stash.
