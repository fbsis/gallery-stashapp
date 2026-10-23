/* Runs inside Stash, using the React and Apollo instances exposed by PluginApi. */
(function () {
  "use strict";
  const api = window.PluginApi;
  const core = window.GalleryStashappCore;
  if (window.__galleryStashappLoaded) return;
  if (!api?.patch?.instead || !api.React || !api.libraries?.Apollo?.gql ||
      !api.utils?.StashService?.getClient || !api.libraries?.Bootstrap?.Modal ||
      !api.libraries?.ReactRouterDOM?.Link || !core) {
    console.error("[gallery-stashapp] PluginApi incompatível. A interface original foi preservada.");
    return;
  }
  window.__galleryStashappLoaded = true;
  const React = api.React;
  const h = React.createElement;
  const { useEffect, useMemo, useState } = React;
  const { Modal } = api.libraries.Bootstrap;
  const { Link } = api.libraries.ReactRouterDOM;
  const documents = new Map();

  async function query(document, variables, signal) {
    if (!documents.has(document)) documents.set(document, api.libraries.Apollo.gql(document));
    const result = await api.utils.StashService.getClient().query({
      query: documents.get(document), variables, fetchPolicy: "no-cache",
      context: { fetchOptions: { signal }, queryDeduplication: false },
    });
    if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join("; "));
    return result.data;
  }

  function MediaViewer({ item, onClose, onPrevious, onNext, position, total }) {
    const [streams, setStreams] = useState([]);
    const [source, setSource] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(item.kind === "video");

    useEffect(() => {
      if (item.kind !== "video") return;
      const controller = new AbortController();
      let cancelled = false;
      query(core.QUERIES.streams, { id: item.id }, controller.signal).then((data) => {
        if (cancelled) return;
        const choices = core.streamChoices(data?.findScene?.sceneStreams);
        if (!choices.length) throw new Error("O Stash não disponibilizou um stream para este vídeo.");
        const video = document.createElement("video");
        const preferred = choices.find((choice) => choice.mime_type && video.canPlayType(choice.mime_type)) ||
          choices.find((choice) => choice.mime_type === "video/mp4") || choices[0];
        setStreams(choices);
        setSource(preferred.url);
        setLoading(false);
      }).catch((cause) => {
        if (!cancelled) {
          setError(cause.message || "Não foi possível carregar o vídeo.");
          setLoading(false);
        }
      });
      return () => { cancelled = true; controller.abort(); };
    }, [item.id, item.kind]);

    function onKeyDown(event) {
      // Keep native video seek keys and form controls working normally.
      if (["VIDEO", "INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
      if (event.key === "ArrowLeft" && onPrevious) { event.preventDefault(); onPrevious(); }
      if (event.key === "ArrowRight" && onNext) { event.preventDefault(); onNext(); }
    }

    return h(Modal, {
      show: true, onHide: onClose, size: "xl", centered: true,
      className: "gs-media-modal", onKeyDown, "aria-labelledby": "gs-viewer-title",
    },
    h(Modal.Header, { closeButton: true },
      h(Modal.Title, { id: "gs-viewer-title" }, item.title)),
    h(Modal.Body, null,
      loading && h("p", { role: "status" }, "Carregando vídeo…"),
      error && h("p", { role: "alert", className: "gs-error" }, error),
      item.kind === "image"
        ? (item.source ? h("img", {
          className: "gs-full-image", src: item.source, alt: item.title,
          onError: () => setError("Não foi possível carregar a imagem."),
        }) : h("p", { role: "alert" }, "Imagem indisponível."))
        : (source && h("video", {
          key: source, className: "gs-player", src: source, poster: item.thumbnail || undefined,
          controls: true, playsInline: true, preload: "metadata",
          onError: () => setError("O navegador não reproduziu este formato. Selecione outro stream abaixo."),
        }))),
    h(Modal.Footer, null,
      h("span", { className: "gs-viewer-position" }, `${position} / ${total}`),
      streams.length > 1 && h("label", { className: "gs-stream-label" }, "Stream ",
        h("select", {
          className: "form-control form-control-sm", value: source,
          onChange: (event) => { setError(""); setSource(event.target.value); },
        }, streams.map((stream, index) => h("option", { key: stream.url, value: stream.url },
          stream.label || stream.mime_type || `Formato ${index + 1}`)))),
      h(Link, {
        to: `/${item.kind === "video" ? "scenes" : "images"}/${item.id}`,
        className: "btn btn-link", onClick: onClose,
      }, "Abrir detalhes"),
      h("button", { type: "button", className: "btn btn-secondary", disabled: !onPrevious,
        onClick: onPrevious, "aria-label": "Mídia anterior" }, "← Anterior"),
      h("button", { type: "button", className: "btn btn-secondary", disabled: !onNext,
        onClick: onNext, "aria-label": "Próxima mídia" }, "Próxima →")));
  }

  function MediaCard({ item, onOpen }) {
    const [broken, setBroken] = useState(false);
    return h("button", {
      type: "button", className: "gs-card", onClick: onOpen,
      title: item.path || item.title,
      "aria-label": `${item.kind === "video" ? "Reproduzir vídeo" : "Abrir imagem"}: ${item.title}`,
    },
    h("span", { className: "gs-card-preview" },
      item.thumbnail && !broken
        ? h("img", { src: item.thumbnail, alt: "", loading: "lazy", onError: () => setBroken(true) })
        : h("span", { className: "gs-placeholder", "aria-hidden": true }, item.kind === "video" ? "▶" : "▧"),
      item.kind === "video" && h("span", { className: "gs-play", "aria-hidden": true }, "▶"),
      item.kind === "video" && core.formatDuration(item.duration) &&
        h("span", { className: "gs-duration" }, core.formatDuration(item.duration))),
    h("span", { className: "gs-card-title" }, item.title),
    h("span", { className: "gs-card-kind" }, item.kind === "video" ? "Vídeo" : "Imagem"));
  }

  function MixedGallery({ original, originalProps }) {
    const { gallery, active } = originalProps;
    const folderId = gallery?.folder?.id;
    const supported = Boolean(folderId);
    const [native, setNative] = useState(false);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const [search, setSearch] = useState("");
    const [kind, setKind] = useState("all");
    const [sort, setSort] = useState("path");
    const [descending, setDescending] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(40);
    const [selected, setSelected] = useState(null);

    useEffect(() => {
      if (!supported || native || active === false) return;
      const controller = new AbortController();
      let cancelled = false;
      setLoading(true);
      setError("");
      setSelected(null);
      core.loadMedia(query, gallery.id, folderId, controller.signal).then((media) => {
        if (!cancelled) { setItems(media); setLoading(false); }
      }).catch((cause) => {
        controller.abort();
        if (!cancelled) { setError(cause.message || "Não foi possível carregar as mídias."); setLoading(false); }
      });
      return () => { cancelled = true; controller.abort(); };
    }, [gallery.id, folderId, gallery.updated_at, supported, native, active, revision]);

    const filtered = useMemo(() => core.selectMedia(items, { search, kind, sort, descending }),
      [items, search, kind, sort, descending]);
    const paged = core.paginate(filtered, page, pageSize);
    const selectedIndex = filtered.findIndex((item) => item.key === selected);
    const imageCount = items.filter((item) => item.kind === "image").length;
    const videoCount = items.length - imageCount;

    function change(setter, value) { setter(value); setPage(1); setSelected(null); }

    function pager() {
      return h("div", { className: "gs-pagination", "aria-label": "Paginação de mídias" },
        h("span", { "aria-live": "polite" }, `${paged.first}–${paged.last} de ${paged.total}`),
        h("button", { type: "button", className: "btn btn-secondary btn-sm", disabled: paged.page <= 1,
          onClick: () => setPage(paged.page - 1), "aria-label": "Página anterior" }, "←"),
        h("span", null, `${paged.page} / ${paged.pages}`),
        h("button", { type: "button", className: "btn btn-secondary btn-sm", disabled: paged.page >= paged.pages,
          onClick: () => setPage(paged.page + 1), "aria-label": "Próxima página" }, "→"));
    }

    // Archives and galleries without a physical folder keep the native UI.
    if (!supported) return h(original, originalProps);

    return h("section", { className: "gs-gallery", "aria-label": "Fotos e vídeos da galeria" },
      h("header", { className: "gs-heading" },
        h("div", null, h("h3", null, "Fotos e vídeos"),
          h("small", { className: "gs-folder", title: gallery.folder.path }, gallery.folder.path)),
        h("button", { type: "button", className: "btn btn-outline-secondary btn-sm",
          onClick: () => { setSelected(null); setNative(!native); } },
        native ? "Mostrar fotos e vídeos" : "Grade original")),
      native ? h(original, originalProps) : h(React.Fragment, null,
        h("div", { className: "gs-toolbar" },
          h("label", null, "Buscar", h("input", {
            type: "search", className: "form-control form-control-sm", value: search,
            placeholder: "Nome ou caminho…", onChange: (event) => change(setSearch, event.target.value),
          })),
          h("label", null, "Tipo", h("select", {
            className: "form-control form-control-sm", value: kind,
            onChange: (event) => change(setKind, event.target.value),
          }, h("option", { value: "all" }, "Fotos e vídeos"),
          h("option", { value: "image" }, "Só imagens"), h("option", { value: "video" }, "Só vídeos"))),
          h("label", null, "Ordenar", h("select", {
            className: "form-control form-control-sm", value: sort,
            onChange: (event) => change(setSort, event.target.value),
          }, h("option", { value: "path" }, "Caminho"), h("option", { value: "title" }, "Título"))),
          h("button", { type: "button", className: "btn btn-secondary btn-sm", "aria-label": "Inverter ordenação",
            onClick: () => change(setDescending, !descending) }, descending ? "↓" : "↑"),
          h("label", null, "Por página", h("select", {
            className: "form-control form-control-sm", value: pageSize,
            onChange: (event) => change(setPageSize, Number(event.target.value)),
          }, [20, 40, 80, 160].map((size) => h("option", { key: size, value: size }, size)))),
          h("button", { type: "button", className: "btn btn-secondary btn-sm", disabled: loading,
            onClick: () => setRevision((value) => value + 1) }, "Atualizar")),
        loading ? h("p", { role: "status", className: "gs-status" }, "Carregando fotos e vídeos…")
          : error ? h("div", { role: "alert", className: "alert alert-danger" },
            h("p", null, error), h("p", null, "Tente Atualizar ou use a Grade original. Nenhum arquivo foi alterado."))
            : h(React.Fragment, null,
              h("p", { className: "gs-counts" },
                `${imageCount} ${imageCount === 1 ? "imagem" : "imagens"} · ${videoCount} ${videoCount === 1 ? "vídeo" : "vídeos"}`),
              pager(),
              filtered.length ? h("div", { className: "gs-grid" }, paged.items.map((item) =>
                h(MediaCard, { key: item.key, item, onOpen: () => setSelected(item.key) })))
                : h("p", { className: "gs-status" }, "Nenhuma mídia encontrada com esses filtros."),
              pager()),
        !loading && !error && videoCount === 0 && h("p", { className: "gs-hint" },
          "Não há vídeos indexados nesta pasta. Confira se o scan inclui vídeos e clique em Atualizar. Subpastas não são incluídas.")),
      selectedIndex >= 0 && h(MediaViewer, {
        key: filtered[selectedIndex].key, item: filtered[selectedIndex],
        position: selectedIndex + 1, total: filtered.length, onClose: () => setSelected(null),
        onPrevious: selectedIndex > 0 ? () => setSelected(filtered[selectedIndex - 1].key) : null,
        onNext: selectedIndex + 1 < filtered.length ? () => setSelected(filtered[selectedIndex + 1].key) : null,
      }));
  }

  class GalleryBoundary extends React.Component {
    constructor(props) { super(props); this.state = { error: false }; }
    static getDerivedStateFromError() { return { error: true }; }
    componentDidCatch(error) { console.error("[gallery-stashapp]", error); }
    render() {
      if (!this.state.error) return this.props.children;
      return h(React.Fragment, null,
        h("p", { role: "alert", className: "alert alert-warning" },
          "O plugin encontrou um erro. Exibindo a grade original; consulte o console do navegador."),
        h(this.props.original, this.props.originalProps));
    }
  }

  api.patch.instead("GalleryImagesPanel", function (props, next) {
    return h(GalleryBoundary, { key: props.gallery.id, original: next, originalProps: props },
      h(MixedGallery, { original: next, originalProps: props }));
  });
  console.info("[gallery-stashapp] Grade mista registrada para galerias baseadas em pasta.");
})();
