/* Reuse Stash's image cards, wall, pagination and native lightbox. */
(function () {
  "use strict";
  const api = window.PluginApi;
  const core = window.GalleryStashappCore;
  if (window.__galleryStashappLoaded) return;
  if (!api?.patch?.instead || !api.patch.after || !api.React ||
      !api.ReactDOM?.createPortal || !api.libraries?.Apollo?.gql ||
      !api.utils?.StashService?.getClient || !core) {
    console.error("[gallery-stashapp] PluginApi incompatível. A interface original foi preservada.");
    return;
  }
  window.__galleryStashappLoaded = true;
  const React = api.React;
  const h = React.createElement;
  const { useCallback, useEffect, useMemo, useRef, useState } = React;
  const documents = new Map();
  const EMPTY_SELECTION = new Set();

  async function query(document, variables, signal) {
    if (!documents.has(document)) documents.set(document, api.libraries.Apollo.gql(document));
    const result = await api.utils.StashService.getClient().query({
      query: documents.get(document), variables, fetchPolicy: "no-cache",
      context: { fetchOptions: { signal }, queryDeduplication: false },
    });
    if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join("; "));
    return result.data;
  }

  function VideoControls({ video, entry, footer, center }) {
    const [streams, setStreams] = useState([]);
    const [source, setSource] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    function applySource(url) {
      setError("");
      setSource(url);
      video.src = core.markVideoURL(url, entry._gsNative.id);
      const playing = video.play();
      playing?.catch(() => {}); // Autoplay may be blocked; native controls remain available.
    }

    useEffect(() => {
      const controller = new AbortController();
      let cancelled = false;
      function onError() { setError("Formato indisponível. Tente outro stream."); }
      video.addEventListener("error", onError);
      query(core.QUERIES.streams, { id: entry._gsNative.id }, controller.signal).then((data) => {
        if (cancelled) return;
        const choices = core.streamChoices(data?.findScene?.sceneStreams);
        if (!choices.length) throw new Error("O Stash não disponibilizou um stream para este vídeo.");
        const preferred = choices.find((choice) => choice.mime_type && video.canPlayType(choice.mime_type)) ||
          choices.find((choice) => choice.mime_type === "video/mp4") || choices[0];
        setStreams(choices);
        setLoading(false);
        applySource(preferred.url);
      }).catch((cause) => {
        if (!cancelled) { setError(cause.message || "Não foi possível carregar o vídeo."); setLoading(false); }
      });
      return () => {
        cancelled = true;
        controller.abort();
        video.removeEventListener("error", onError);
      };
    }, [video, entry._gsNative.id]);

    return h(React.Fragment, null,
      center && api.ReactDOM.createPortal(h("span", { className: "gs-native-video-title" }, entry.title), center),
      footer && api.ReactDOM.createPortal(h("div", { className: "gs-native-video-controls" },
        loading && h("small", { role: "status" }, "Carregando vídeo…"),
        error && h("small", { role: "alert", className: "gs-error" }, error),
        streams.length > 1 && h("label", null, "Stream ", h("select", {
          className: "form-control form-control-sm", value: source, "aria-label": "Stream do vídeo",
          onKeyDown: (event) => event.stopPropagation(),
          onChange: (event) => applySource(event.target.value),
        }, streams.map((stream, index) => h("option", { key: stream.url, value: stream.url },
          stream.label || stream.mime_type || `Formato ${index + 1}`))))), footer));
  }

  // The native lightbox is not a patchable component. Its normal image rendering
  // stays untouched. This small, scoped bridge only enables controls on our video
  // slides, suppresses image-only links and pauses videos when navigation leaves them.
  function NativeVideoBridge({ entries }) {
    const [active, setActive] = useState(null);
    const activeRef = useRef(null);
    const entriesRef = useRef(entries);
    entriesRef.current = entries;

    useEffect(() => {
      let disposed = false;
      let releaseVideo = () => {};
      let lightbox = null;
      let serial = 0;

      function synchronize() {
        if (disposed) return;
        const box = document.querySelector(".Lightbox");
        const carousel = box?.querySelector(".Lightbox-carousel");
        const index = carousel ? Math.round(-(parseFloat(carousel.style.left) || 0) / 100) : -1;
        const slot = index >= 0 ? carousel.children[index] : null;
        const video = slot?.querySelector("video");
        const id = core.sceneIdFromURL(video?.getAttribute("src"));
        const entry = id ? entriesRef.current.find((image) => image._gsNative?.kind === "video" && image._gsNative.id === id) : null;
        const current = entry ? video : null;
        if (activeRef.current?.video === current) return;
        releaseVideo();
        releaseVideo = () => {};
        lightbox?.classList.remove("gs-native-video-active");
        lightbox = box;
        activeRef.current = current ? { video: current } : null;
        if (!current) { setActive(null); return; }

        box.classList.add("gs-native-video-active");
        const oldControls = current.controls;
        const oldPoster = current.getAttribute("poster");
        current.controls = true;
        current.playsInline = true;
        current.poster = entry.paths.thumbnail.split("#")[0];
        // Native image click/drag handlers must not consume the player's controls.
        const stop = (event) => event.stopPropagation();
        const events = ["mousedown", "mouseup", "click", "touchstart", "touchmove", "pointerdown", "pointermove", "pointerup"];
        events.forEach((name) => current.addEventListener(name, stop));
        releaseVideo = () => {
          current.pause();
          current.controls = oldControls;
          if (oldPoster === null) current.removeAttribute("poster");
          else current.setAttribute("poster", oldPoster);
          events.forEach((name) => current.removeEventListener(name, stop));
        };
        setActive({ video: current, entry, serial: ++serial,
          footer: box.querySelector(".Lightbox-footer-right"),
          center: box.querySelector(".Lightbox-footer-center") });
      }

      function onKeyDown(event) {
        if (activeRef.current?.video === event.target && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
          event.preventDefault(); // Keep native lightbox navigation, not video seeking.
        }
      }
      function onClick(event) {
        if (activeRef.current && event.target.closest?.(".Lightbox-footer-center a.image-link")) {
          event.preventDefault();
          event.stopPropagation(); // A scene has no /images/:id destination.
        }
      }
      function onPlay(event) {
        if (core.sceneIdFromURL(event.target.getAttribute?.("src")) && event.target !== activeRef.current?.video) {
          event.target.pause();
        }
      }
      const observer = new MutationObserver(synchronize);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("play", onPlay, true);
      synchronize();
      return () => {
        disposed = true;
        observer.disconnect();
        releaseVideo();
        lightbox?.classList.remove("gs-native-video-active");
        activeRef.current = null;
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("play", onPlay, true);
      };
    }, []);
    return active ? h(VideoControls, { key: active.serial, ...active }) : null;
  }

  function MixedGallery({ original, originalProps }) {
    const { gallery, active } = originalProps;
    const folderId = gallery?.folder?.id;
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
    const [displayMode, setDisplayMode] = useState(0); // Native DisplayMode.Grid / Wall.
    const [zoomIndex, setZoomIndex] = useState(1);
    const [slideshowRunning, setSlideshowRunning] = useState(false);

    useEffect(() => {
      if (!folderId || native || active === false) return;
      const controller = new AbortController();
      let cancelled = false;
      setLoading(true);
      setError("");
      core.loadMedia(query, gallery.id, folderId, controller.signal).then((media) => {
        if (!cancelled) { setItems(media); setLoading(false); }
      }).catch((cause) => {
        controller.abort();
        if (!cancelled) { setError(cause.message || "Não foi possível carregar as mídias."); setLoading(false); }
      });
      return () => { cancelled = true; controller.abort(); };
    }, [gallery.id, folderId, gallery.updated_at, native, active, revision]);

    const filtered = useMemo(() => core.selectMedia(items, { search, kind, sort, descending }),
      [items, search, kind, sort, descending]);
    const paged = core.paginate(filtered, page, pageSize);
    const entries = useMemo(() => core.nativeEntries(core.paginate(filtered, paged.page, pageSize).items),
      [filtered, paged.page, pageSize]);
    const filter = useMemo(() => ({ displayMode, zoomIndex, currentPage: paged.page,
      itemsPerPage: pageSize, sortBy: sort, sortDirection: descending ? "DESC" : "ASC" }),
    [displayMode, zoomIndex, paged.page, pageSize, sort, descending]);
    const onSlideshowChange = useCallback((running) => {
      setSlideshowRunning(running);
      if (!running) setRevision((value) => value + 1); // Refresh edits/deletions made in the native viewer.
    }, []);
    const imageCount = items.filter((item) => item.kind === "image").length;
    const videoCount = items.length - imageCount;
    const { ImageList, Pagination, PaginationIndex } = api.components || {};
    function change(setter, value) { setter(value); setPage(1); }
    function pager() {
      return h("div", { className: "pagination-index-container" },
        h(Pagination, { currentPage: paged.page, itemsPerPage: pageSize,
          totalItems: paged.total, onChangePage: setPage }),
        h(PaginationIndex, { currentPage: paged.page, itemsPerPage: pageSize, totalItems: paged.total }));
    }

    if (!folderId) return h(original, originalProps);
    if (!ImageList || !Pagination || !PaginationIndex) return h(React.Fragment, null,
      h("p", { role: "alert", className: "alert alert-warning" },
        "Esta versão do Stash não expõe a grade nativa necessária. Exibindo a galeria original."),
      h(original, originalProps));

    return h("section", { className: "gs-gallery gs-native-gallery", "aria-label": "Fotos e vídeos da galeria" },
      h("header", { className: "gs-heading" },
        h("small", { className: "gs-folder", title: gallery.folder.path }, gallery.folder.path),
        h("button", { type: "button", className: "btn btn-outline-secondary btn-sm",
          onClick: () => setNative(!native) }, native ? "Mostrar fotos e vídeos" : "Ferramentas originais")),
      native ? h(original, originalProps) : h(React.Fragment, null,
        h("div", { className: "gs-toolbar" },
          h("input", { type: "search", className: "form-control form-control-sm", value: search,
            "aria-label": "Buscar mídias", placeholder: "Buscar…",
            onChange: (event) => change(setSearch, event.target.value) }),
          h("select", { className: "form-control form-control-sm", value: kind, "aria-label": "Tipo de mídia",
            onChange: (event) => change(setKind, event.target.value) },
          h("option", { value: "all" }, "Fotos e vídeos"), h("option", { value: "image" }, "Só imagens"),
          h("option", { value: "video" }, "Só vídeos")),
          h("select", { className: "form-control form-control-sm", value: sort, "aria-label": "Ordenação",
            onChange: (event) => change(setSort, event.target.value) },
          h("option", { value: "path" }, "Caminho"), h("option", { value: "title" }, "Título")),
          h("button", { type: "button", className: "btn btn-secondary btn-sm", "aria-label": "Inverter ordenação",
            onClick: () => change(setDescending, !descending) }, descending ? "↓" : "↑"),
          h("select", { className: "form-control form-control-sm", value: pageSize, "aria-label": "Itens por página",
            onChange: (event) => change(setPageSize, Number(event.target.value)) },
          [20, 40, 80, 160].map((size) => h("option", { key: size, value: size }, size))),
          h("button", { type: "button", className: `btn btn-sm ${displayMode === 0 ? "btn-primary" : "btn-secondary"}`,
            "aria-label": "Grade", "aria-pressed": displayMode === 0, onClick: () => setDisplayMode(0) }, "▦"),
          h("button", { type: "button", className: `btn btn-sm ${displayMode === 2 ? "btn-primary" : "btn-secondary"}`,
            "aria-label": "Mural", "aria-pressed": displayMode === 2, onClick: () => setDisplayMode(2) }, "▧"),
          h("input", { type: "range", min: 0, max: 3, step: 1, value: zoomIndex,
            "aria-label": "Tamanho das miniaturas", onChange: (event) => setZoomIndex(Number(event.target.value)) }),
          h("button", { type: "button", className: "btn btn-secondary btn-sm", disabled: loading,
            onClick: () => setRevision((value) => value + 1) }, "Atualizar")),
        loading ? h("p", { role: "status", className: "gs-status" }, "Carregando fotos e vídeos…")
          : error ? h("div", { role: "alert", className: "alert alert-danger" },
            h("p", null, error), h("p", null, "Tente Atualizar ou use as Ferramentas originais. Nenhum arquivo foi alterado."))
            : h(React.Fragment, null,
              h("small", { className: "gs-counts" },
                `${imageCount} ${imageCount === 1 ? "imagem" : "imagens"} · ${videoCount} ${videoCount === 1 ? "vídeo" : "vídeos"}`),
              pager(),
              filtered.length ? h(ImageList, {
                _gsMixed: true, images: entries, filter, selectedIds: EMPTY_SELECTION,
                onSelectChange: () => {}, onChangePage: setPage,
                pageCount: paged.pages, totalCount: paged.total,
                slideshowRunning, setSlideshowRunning: onSlideshowChange,
                // Chapters index images only, so cannot index a mixed sequence safely.
                chapters: [],
              }) : h("p", { className: "gs-status" }, "Nenhuma mídia encontrada com esses filtros."),
              pager(), h(NativeVideoBridge, { entries })),
        !loading && !error && videoCount === 0 && h("p", { className: "gs-hint" },
          "Não há vídeos indexados nesta pasta. Confira o scan e clique em Atualizar. Subpastas não são incluídas.")));
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

  // Stash appends the result/next function after all React arguments, including
  // legacy context. Read the final argument rather than assuming it is second.
  // Keep real image IDs inside the native viewer; give video cards unique display
  // keys only AFTER ImageList has built its lightbox state with ID-less videos.
  api.patch.after("ImageList", function (props, ...args) {
    const rendered = args[args.length - 1];
    if (!props._gsMixed || !React.isValidElement(rendered)) return rendered;
    return React.cloneElement(rendered, {
      images: core.gridEntries(props.images), selectedIds: EMPTY_SELECTION,
      onSelectChange: undefined, selecting: false,
    });
  });

  api.patch.after("ImageCard", function (props, ...args) {
    const rendered = args[args.length - 1];
    const marker = props.image?._gsNative;
    if (!marker || !React.isValidElement(rendered)) return rendered;
    const video = marker.kind === "video";
    const card = React.cloneElement(rendered, {
      onSelectedChanged: undefined, selected: false, selecting: false,
      ...(video ? { url: `/scenes/${marker.id}`, popovers: null, overlays: null,
        details: h("small", { className: "gs-native-duration" }, `▶ ${core.formatDuration(marker.duration)}`) } : {}),
    });
    return h("div", { className: "gs-native-card-shell", onClickCapture: (event) => {
      const target = event.target.closest?.("a");
      if (!props.onPreview || !target || (!video && !target.classList.contains("image-card-link")) ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      props.onPreview(event);
    } }, card);
  });

  api.patch.after("ImageCard.Image", function (props, ...args) {
    const rendered = args[args.length - 1];
    if (props.image?._gsNative?.kind !== "video") return rendered;
    return h(React.Fragment, null, rendered, h("span", { className: "gs-native-play", "aria-hidden": true }, "▶"));
  });

  api.patch.instead("GalleryImagesPanel", function (props, ...args) {
    const next = args[args.length - 1];
    return h(GalleryBoundary, { key: props.gallery.id, original: next, originalProps: props },
      h(MixedGallery, { original: next, originalProps: props }));
  });
  console.info("[gallery-stashapp] Grade e lightbox nativos com vídeos da mesma pasta.");
})();
