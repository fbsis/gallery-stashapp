/* Shared data logic. No React, build step, mutations or external requests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GalleryStashappCore = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const BATCH_SIZE = 250;
  const QUERIES = {
    images: `query GalleryStashappImages($gallery: ID!, $page: Int!, $perPage: Int!) {
      findImages(
        image_filter: { galleries: { value: [$gallery], modifier: INCLUDES } }
        filter: { page: $page, per_page: $perPage, sort: "id", direction: ASC }
      ) {
        count
        images {
          id title
          paths { thumbnail image }
          visual_files {
            ... on ImageFile { path basename parent_folder { id } }
            ... on VideoFile { path basename parent_folder { id } }
          }
        }
      }
    }`,
    scenes: `query GalleryStashappScenes($folder: ID!, $page: Int!, $perPage: Int!) {
      findScenes(
        scene_filter: {
          files_filter: { parent_folder: { value: [$folder], modifier: INCLUDES, depth: 0 } }
        }
        filter: { page: $page, per_page: $perPage, sort: "id", direction: ASC }
      ) {
        count
        scenes {
          id title
          paths { screenshot }
          files { path basename duration parent_folder { id } }
        }
      }
    }`,
    streams: `query GalleryStashappStreams($id: ID!) {
      findScene(id: $id) {
        id
        sceneStreams { url mime_type label }
      }
    }`,
  };

  function abortIfNeeded(signal) {
    if (signal && signal.aborted) {
      const error = new Error("Request aborted");
      error.name = "AbortError";
      throw error;
    }
  }

  async function fetchAll(query, document, variables, resultKey, itemsKey, signal) {
    const result = new Map();
    let received = 0;
    for (let page = 1; ; page += 1) {
      abortIfNeeded(signal);
      const data = await query(document, { ...variables, page, perPage: BATCH_SIZE }, signal);
      abortIfNeeded(signal);
      const batch = data && data[resultKey];
      if (!batch || !Array.isArray(batch[itemsKey]) || !Number.isInteger(batch.count) || batch.count < 0) {
        throw new Error("Resposta inesperada do Stash ao carregar as mídias.");
      }
      const items = batch[itemsKey];
      if (!items.length && received < batch.count) {
        throw new Error("A biblioteca mudou durante a consulta. Clique em Atualizar.");
      }
      for (const item of items) result.set(String(item.id), item);
      received += items.length;
      if (received >= batch.count) {
        if (result.size !== batch.count) {
          throw new Error("A biblioteca mudou durante a consulta. Clique em Atualizar.");
        }
        break;
      }
    }
    return Array.from(result.values());
  }

  function matchingFile(files, folderId) {
    return (files || []).find((file) => String(file.parent_folder?.id) === String(folderId));
  }

  function toMedia(images, scenes, folderId) {
    const items = new Map();
    for (const image of images) {
      const file = matchingFile(image.visual_files, folderId) || image.visual_files?.[0];
      const item = {
        key: `image:${image.id}`, id: String(image.id), kind: "image",
        title: image.title || file?.basename || `Imagem ${image.id}`,
        path: file?.path || "", thumbnail: image.paths?.thumbnail || "",
        source: image.paths?.image || "", duration: null,
      };
      items.set(item.key, item);
    }
    for (const scene of scenes) {
      // Double-check the exact folder even if the server filter changes semantics.
      const file = matchingFile(scene.files, folderId);
      if (!file) continue;
      const item = {
        key: `video:${scene.id}`, id: String(scene.id), kind: "video",
        title: scene.title || file.basename || `Vídeo ${scene.id}`,
        path: file.path || "", thumbnail: scene.paths?.screenshot || "",
        source: "", duration: file.duration,
      };
      items.set(item.key, item);
    }
    return Array.from(items.values());
  }

  async function loadMedia(query, galleryId, folderId, signal) {
    if (!galleryId || !folderId) throw new Error("A galeria precisa estar associada a uma pasta.");
    const [images, scenes] = await Promise.all([
      fetchAll(query, QUERIES.images, { gallery: String(galleryId) }, "findImages", "images", signal),
      fetchAll(query, QUERIES.scenes, { folder: String(folderId) }, "findScenes", "scenes", signal),
    ]);
    return toMedia(images, scenes, folderId);
  }

  function selectMedia(items, options = {}) {
    const search = (options.search || "").trim().toLocaleLowerCase();
    const filtered = items.filter((item) =>
      (!options.kind || options.kind === "all" || item.kind === options.kind) &&
      (!search || `${item.title}\n${item.path}`.toLocaleLowerCase().includes(search))
    );
    const field = options.sort === "title" ? "title" : "path";
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const direction = options.descending ? -1 : 1;
    return filtered.sort((a, b) => direction * (
      collator.compare(a[field], b[field]) || collator.compare(a.key, b.key)
    ));
  }

  function paginate(items, requestedPage, pageSize) {
    const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 40;
    const pages = Math.max(1, Math.ceil(items.length / size));
    const page = Math.min(pages, Math.max(1, Number.isInteger(requestedPage) ? requestedPage : 1));
    const offset = (page - 1) * size;
    return { items: items.slice(offset, offset + size), page, pages, total: items.length,
      first: items.length ? offset + 1 : 0, last: Math.min(offset + size, items.length) };
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "";
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = String(total % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
  }

  function streamChoices(streams) {
    const seen = new Set();
    return (streams || []).filter((stream) => {
      if (!stream.url || seen.has(stream.url)) return false;
      seen.add(stream.url);
      return true;
    });
  }

  return { BATCH_SIZE, QUERIES, fetchAll, matchingFile, toMedia, loadMedia,
    selectMedia, paginate, formatDuration, streamChoices };
});
