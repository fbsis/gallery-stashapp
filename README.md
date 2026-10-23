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
- Não grava associações, não altera metadados e não acessa diretamente o banco ou os arquivos do servidor.
- Oferece busca, filtro por tipo, ordenação natural por caminho/título e paginação mista.
- Abre imagens e vídeos em um modal, com navegação anterior/próxima.
- Usa os streams fornecidos pelo Stash, com seletor de formatos quando disponíveis.
- Mantém um botão **Grade original**, para usar as ferramentas nativas de edição, seleção, capas e remoção.

A aba nativa pode continuar se chamando **Images/Imagens**. Seu conteúdo recebe a grade mista; o plugin não adiciona uma aba de cenas.

## Requisitos e compatibilidade

- Stash com `PluginApi.patch.instead`, o ponto de extensão **`GalleryImagesPanel`**, Apollo e React Bootstrap expostos pela API de plugins.
- Uma galeria **baseada em pasta** (`Gallery.folder`). Galerias ZIP e galerias sem pasta física mantêm a interface original.
- Os vídeos precisam ter sido indexados pelo scan do Stash. Confira se a pasta da biblioteca não está configurada para excluir vídeos.
- A API GraphQL deve oferecer `Image.visual_files`, `SceneFilterType.files_filter`, `FileFilterType.parent_folder` e `Scene.sceneStreams`.

**Referências verificadas:** Stash **v0.31.1** e branch `develop`, commit `bdee3c8`. O ponto de extensão foi conferido no código da versão estável e as consultas foram validadas contra os dois schemas GraphQL. A interface tem testes automatizados com React 17 e uma API de host simulada; a reprodução real e a integração com a versão instalada ainda precisam ser testadas no seu Stash. Não há garantia de compatibilidade com todas as versões ou com outros plugins que substituam a mesma grade.

O plugin usa a API de interface experimental do Stash; atualizações podem exigir ajustes. Ao abrir uma galeria, você pode verificar o ponto de extensão no console do navegador:

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

## Limites desta primeira versão

- Não cria galerias novas para pastas que só tenham vídeos; melhora a visualização de galerias de pasta que já existem.
- Não inclui vídeos de subpastas, ZIPs ou arquivos que ainda não foram indexados.
- Os dados são recarregados ao abrir a grade ou clicar em **Atualizar**. Se executar um scan com a galeria aberta, clique nesse botão depois.
- Busca e ordenação são locais: as mídias são consultadas em lotes de 250 registros, e só a página visível renderiza miniaturas. Galerias muito grandes ainda precisam carregar seus metadados completos para ordenar e paginar fotos e vídeos juntos.
- O visualizador usa o player HTML5 do navegador. MP4/WebM e outros formatos dependem do navegador e da configuração de streaming/FFmpeg do Stash. HLS/DASH não recebem uma biblioteca adicional de reprodução; selecione um stream compatível quando necessário.
- Não implementa os recursos avançados do player nativo, capítulos, slideshow, contagem de reprodução ou histórico de progresso. O Stash pode gerar/transcodificar mídia ao atender streams, conforme sua configuração.
- Se uma cena possui múltiplos arquivos/versões, basta um arquivo estar na pasta para aparecer; a reprodução usa a versão escolhida pelo próprio Stash.
- As operações nativas de seleção, edição em lote, definição de capa e remoção permanecem disponíveis em **Grade original**.

## Diagnóstico

**O plugin não aparece em Settings → Plugins:** confira se a pasta está no diretório de configuração correto e se o `.yml` foi copiado.

**A grade continua igual:** faça uma recarga completa, confira se customizações de interface não estão desabilitadas e procure mensagens `[gallery-stashapp]` no console. Verifique o ponto de extensão citado na seção de compatibilidade.

**Aparecem somente fotos:** confira se a galeria é baseada em pasta e se os vídeos foram indexados nessa pasta exata, sem exclusões. Clique em **Atualizar** depois do scan.

**Erro de GraphQL/campo desconhecido:** use **Grade original** e informe a versão do Stash e a mensagem exibida. A versão instalada pode não oferecer o schema esperado.

**Vídeo não reproduz:** tente outro stream no seletor; confira FFmpeg e streaming nas configurações do Stash. O link **Abrir detalhes** permite conferir a reprodução no player nativo.

## Desenvolvimento e testes

Node.js 20+ é necessário apenas para desenvolver e testar:

```bash
npm ci
npm run check
npm test
```

Os testes cobrem consulta paginada, seleção da pasta exata, mídia mista, ordenação, filtros, cancelamento, troca de galeria, erros, retorno à interface original e abertura do visualizador.

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
4. Abra uma foto, avance para um vídeo e teste reprodução e fechamento do modal.
5. Teste busca, tipos, ordenação, paginação e o botão **Grade original**.
6. Execute um scan com mídia nova e clique em **Atualizar**.
7. Abra uma galeria ZIP: ela deve manter a interface original.
8. Desabilite o plugin e recarregue a página: a interface original deve voltar sem mudanças nos dados.

## Licença

MIT. Projeto independente, não oficial do Stash.
