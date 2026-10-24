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
          id title code date urls details photographer rating100 organized o_counter
          paths { thumbnail preview image }
          galleries { id title files { path } folder { path } }
          studio { id name image_path }
          tags { id name }
          performers { id name gender favorite image_path }
          visual_files {
            __typename
            ... on ImageFile { path basename width height parent_folder { id } }
            ... on VideoFile { path basename width height video_codec parent_folder { id } }
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
          paths { screenshot stream }
          files { path basename width height video_codec duration parent_folder { id } }
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
        throw new Error("Unexpected response from Stash while loading media.");
      }
      const items = batch[itemsKey];
      if (!items.length && received < batch.count) {
        throw new Error("The library changed during the query. Click Refresh.");
      }
      for (const item of items) result.set(String(item.id), item);
      received += items.length;
      if (received >= batch.count) {
        if (result.size !== batch.count) {
          throw new Error("The library changed during the query. Click Refresh.");
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
        title: image.title || file?.basename || `Image ${image.id}`,
        path: file?.path || "", thumbnail: image.paths?.thumbnail || "",
        source: image.paths?.image || "", duration: null, raw: image,
      };
      items.set(item.key, item);
    }
    for (const scene of scenes) {
      // Double-check the exact folder even if the server filter changes semantics.
      const file = matchingFile(scene.files, folderId);
      if (!file) continue;
      const item = {
        key: `video:${scene.id}`, id: String(scene.id), kind: "video",
        title: scene.title || file.basename || `Video ${scene.id}`,
        path: file.path || "", thumbnail: scene.paths?.screenshot || "",
        source: scene.paths?.stream || "", duration: file.duration, raw: scene, file,
      };
      items.set(item.key, item);
    }
    return Array.from(items.values());
  }

  async function loadMedia(query, galleryId, folderId, signal) {
    if (!galleryId || !folderId) throw new Error("The gallery must be associated with a folder.");
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

  // Use Stash's endpoint and resolution parameters, not the list's arrival
  // order or translated labels. Never rewrite signed stream URLs.
  function streamInfo(stream) {
    let direct = false;
    let resolution = "";
    try {
      const url = new URL(stream.url, "https://stash.invalid/");
      resolution = (url.searchParams.get("resolution") || "").toUpperCase();
      direct = /\/stream\/?$/.test(url.pathname) && !resolution;
    } catch (_) { /* Keep unfamiliar endpoints selectable with their server label. */ }
    const original = resolution === "ORIGINAL";
    const heights = { LOW: 240, STANDARD: 480, STANDARD_HD: 720, FULL_HD: 1080, FOUR_K: 2160 };
    const height = heights[resolution] || Number(/\b(\d{3,4})p\b/i.exec(stream.label || "")?.[1]) || 0;
    return { direct, original, rank: direct ? 0 : original ? 1 : 2, height };
  }

  function streamChoices(streams) {
    const seen = new Set();
    return (streams || []).filter((stream) => {
      if (!stream?.url || seen.has(stream.url)) return false;
      seen.add(stream.url);
      return true;
    }).sort((a, b) => {
      const left = streamInfo(a);
      const right = streamInfo(b);
      return left.rank - right.rank || right.height - left.height;
    });
  }

  function preferredStream(streams, canPlayType = () => "") {
    const choices = streamChoices(streams);
    // MIME detection cannot guarantee codec support. Try direct first and let
    // the user choose another quality if their browser cannot decode it.
    return choices.find((stream) => streamInfo(stream).direct) ||
      choices.find((stream) => stream.mime_type && canPlayType(stream.mime_type)) ||
      choices.find((stream) => stream.mime_type === "video/mp4") || choices[0];
  }

  function streamLabel(stream) {
    const { direct, original } = streamInfo(stream);
    const label = stream.label || stream.mime_type || "Stream";
    if (direct) return "Original / Direct stream";
    return original && !/\boriginal\b/i.test(label) ? `${label} (Original resolution)` : label;
  }

  function markVideoURL(url, sceneId) {
    return `${(url || "about:blank").split("#")[0]}#gs-scene=${encodeURIComponent(sceneId)}`;
  }

  function sceneIdFromURL(url) {
    const match = /#gs-scene=([^&]+)/.exec(url || "");
    try { return match ? decodeURIComponent(match[1]) : null; }
    catch (_) { return null; }
  }

  // Native ImageList uses these entries only for display and the lightbox.
  // Scenes deliberately have NO image ID: native rating, delete and D/D actions
  // must never receive a scene ID (an unrelated image can have the same ID).
  function nativeEntries(items) {
    return items.map((item) => {
      const marker = { key: item.key, kind: item.kind, id: item.id, duration: item.duration };
      if (item.kind === "image") {
        return {
          ...item.raw, id: item.id, title: item.raw?.title || item.title,
          tags: item.raw?.tags || [], performers: item.raw?.performers || [],
          galleries: item.raw?.galleries || [], studio: item.raw?.studio || null,
          paths: { ...item.raw?.paths, image: item.source, thumbnail: item.thumbnail,
            preview: item.raw?.paths?.preview || "" },
          visual_files: item.raw?.visual_files || [], _gsNative: marker,
        };
      }
      const file = item.raw?.files?.[0] || item.file || {};
      return {
        id: undefined, title: item.title, tags: [], performers: [], galleries: [],
        studio: null, organized: false,
        paths: { image: markVideoURL(item.source, item.id),
          thumbnail: markVideoURL(item.thumbnail, item.id), preview: "" },
        visual_files: [{ __typename: "VideoFile", path: item.path,
          width: file.width || 1920, height: file.height || 1080,
          video_codec: file.video_codec === "gif" ? "unknown" : (file.video_codec || "unknown") }],
        _gsNative: marker,
      };
    });
  }

  // Grid/wall keys are separate from real image IDs. These display-only keys
  // are NEVER passed to the native lightbox or to image mutations.
  function gridEntries(entries) {
    return entries.map((entry) => entry._gsNative?.kind === "video"
      ? { ...entry, id: `gs-video:${entry._gsNative.id}` } : entry);
  }

  return { BATCH_SIZE, QUERIES, fetchAll, matchingFile, toMedia, loadMedia,
    selectMedia, paginate, formatDuration, streamChoices, preferredStream, streamLabel, nativeEntries, gridEntries,
    markVideoURL, sceneIdFromURL };
});
