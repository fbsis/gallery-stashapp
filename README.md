# gallery-stashapp

A Stash UI plugin that displays **photos and videos together in a gallery grid**, automatically including indexed videos from the same folder.

There is no need to select scenes, link them to the gallery, open another tab, or rebuild Stash. Videos remain **scenes internally**, but appear and play directly from the gallery grid.

## Install using the YAML package source (recommended)

Add this **raw `index.yml` URL** as a plugin source in Stash:

```text
https://raw.githubusercontent.com/fbsis/gallery-stashapp/main/index.yml
```

1. Open **Settings → Plugins → Available Plugins** and add a source.
2. Enter these values:
   - **Name:** `Gallery Stashapp`
   - **URL:** `https://raw.githubusercontent.com/fbsis/gallery-stashapp/main/index.yml`
   - **Local Path:** `gallery-stashapp`
3. Refresh the available plugins list.
4. Select **Gallery Stashapp - Photos and videos** and install it.
5. Fully reload the browser (`Cmd+Shift+R` / `Ctrl+Shift+R`).
6. Open a folder-based gallery containing indexed photos and videos.

**Use `index.yml`, not `gallery-stashapp.yml`, as the package source.** Stash expects a YAML package index that points to a ZIP archive and its SHA-256 checksum. It downloads and installs the plugin files from that archive automatically. Do not paste the GitHub file-view URL, a repository page, or the README URL; HTML pages can cause `reading package list: yaml: ... mapping values are not allowed in this context`.

If a source is already configured incorrectly, edit or remove it before refreshing the list. If you previously installed the plugin manually, remove that copy first to avoid loading the plugin twice.

### What are the two YAML files for?

| File | Purpose | How to use it |
| --- | --- | --- |
| [`index.yml`](https://raw.githubusercontent.com/fbsis/gallery-stashapp/main/index.yml) | Remote package index with the release version, date, ZIP path, and checksum | Paste its raw URL into Stash's plugin source settings |
| [`gallery-stashapp.yml`](gallery-stashapp.yml) | Plugin manifest declaring the JavaScript and CSS files | Keep it alongside those files in the plugin directory for manual installation |

Neither YAML file goes in your media library. Do not replace Stash's main `config.yml` with either file.

## Manual installation using the plugin manifest

No build step or Node.js installation is required. Use the `plugins` directory **next to the `config.yml` used by your Stash instance**. The default is usually `~/.stash/plugins`, but it can differ, especially with Docker.

Copy these four files from the same release, keeping them together:

```text
plugins/
└── gallery-stashapp/
    ├── gallery-stashapp.yml
    ├── gallery-core.js
    ├── gallery-stashapp.js
    └── gallery-stashapp.css
```

The [`gallery-stashapp.yml`](gallery-stashapp.yml) manifest tells Stash which assets to load:

```yaml
name: Gallery Stashapp - Photos and videos
description: Photos and videos from the same folder in Stash's native grid and lightbox, with keyboard navigation and no manual linking.
version: 0.3.0
url: https://github.com/fbsis/gallery-stashapp
ui:
  javascript:
    - gallery-core.js
    - gallery-stashapp.js
  css:
    - gallery-stashapp.css
```

**Copying only the `.yml` file is not enough:** the manifest does not download its JavaScript or CSS dependencies. All four files must be present.

On macOS/Linux, from the root of this repository:

```bash
mkdir -p "$HOME/.stash/plugins/gallery-stashapp"
cp gallery-stashapp.yml gallery-core.js gallery-stashapp.js gallery-stashapp.css \
  "$HOME/.stash/plugins/gallery-stashapp/"
```

For Docker, copy the files into the configuration directory mounted into the container, for example `<host-config>/plugins/gallery-stashapp/`. Do not copy them into a media folder.

Then:

1. Open **Settings → Plugins**.
2. Click **Reload Plugins** and enable **Gallery Stashapp - Photos and videos**, if necessary.
3. Fully reload the browser (`Cmd+Shift+R` / `Ctrl+Shift+R`). Reloading the plugin list alone does not replace JavaScript already running in the page.
4. Open a folder-based gallery. Its **Photos and videos** grid will include videos from the same folder.

Development dependencies are not required to use the plugin.

## How it works

For a gallery based on this folder:

```text
/collection/trip/
├── photo01.jpg
├── video01.mp4
├── photo02.jpg
└── video02.mp4
```

The grid becomes:

```text
[ photo01.jpg ] [ video01.mp4 ▶ ] [ photo02.jpg ] [ video02.mp4 ▶ ]
```

- Preserves images that already belong to the gallery.
- Queries videos from the gallery's **exact folder**, by folder ID; does not use partial path matching or include subfolders.
- Loading the mixed list does not create associations, change metadata, or access the database or server files directly.
- Reuses Stash's **native cards, wall, and pagination**, with adjustable thumbnail sizes.
- Opens photos and videos in the **native lightbox**, using on-screen arrows and **← / →** keys, including navigation across pages. **Esc** closes the viewer.
- Preserves native photo controls: zoom, settings, ratings, and other actions available in your Stash version. Actions you perform with those controls still modify data normally.
- Enables HTML5 controls and a **Quality** selector using the same stream options as Stash's scene player, with **Original / Direct stream** selected by default when offered.
- Never assigns image IDs to videos: image ratings, deletion, and image-specific shortcuts do not target scenes.
- Provides search, media-type filtering, and natural path/title sorting for the mixed list.
- Keeps an **Original tools** button for selection, advanced filters, bulk editing, cover changes, and removal in the native gallery.

The native tab may still be named **Images** (or its localized equivalent). The plugin replaces its content with the mixed grid; it does not add a scenes tab. Plugin-owned text is in English; Stash's native controls follow Stash's language setting.

## Video quality selection

The lightbox's **Quality** selector uses Stash's `Scene.sceneStreams`, the same source list used by its scene player. It keeps the server's format/resolution labels (for example, MP4 HD (720p), MP4 Full HD (1080p), and HLS) and identifies original-resolution transcodes explicitly.

Default selection prioritizes:

1. **Original / Direct stream**, when Stash offers its direct endpoint, regardless of the response order.
2. A browser-compatible **Original resolution** stream, if no direct endpoint is offered.
3. The highest compatible resolution offered by Stash. If MIME detection is inconclusive, MP4 is preferred.

The current choice remains visible even if there is only one option. Changing quality preserves the pause/play state, playback rate, and position when the selected stream supports native seeking. If the original cannot be decoded, an error is shown instead of silently downgrading quality; select another option manually.

**Direct does not always mean the untouched source file:** Stash may serve a previously generated transcode through its direct endpoint. An **Original resolution** MP4/WebM option is also a transcode, not a promise of identical bitrate or lossless playback. The plugin cannot override Stash's server-side stream configuration.

The gallery still uses the native image lightbox with an HTML5 video element, not the full Video.js scene player. Some HLS/DASH options require that full player. Use **Open scene player** to open it in a separate tab with Stash's complete controls and source selector, without losing your gallery page.

## Requirements and compatibility

- Stash with `PluginApi.patch.instead`/`after`, the **`GalleryImagesPanel`**, **`ImageList`**, **`ImageCard`**, and **`ImageCard.Image`** extension points, native pagination components, and ReactDOM/Apollo exposed through the plugin API.
- A **folder-based gallery** (`Gallery.folder`). ZIP galleries and galleries without a physical folder retain the original interface.
- Videos already indexed by a Stash scan. Make sure the library folder is not configured to exclude videos.
- GraphQL support for `Image.visual_files`, `SceneFilterType.files_filter`, `FileFilterType.parent_folder`, and `Scene.sceneStreams`.

**Checked references:** Stash **v0.31.1** and the `develop` branch at commit `bdee3c8`. The extension point was checked against the stable version's source, and queries were validated against both GraphQL schemas. Automated UI tests use React 17 and a simulated host API; actual playback and integration with your installed version still require testing in Stash. Passing tests do not guarantee compatibility with every version or with other plugins that replace the same grid.

The plugin uses Stash's experimental UI API; updates may require adjustments. The lightbox does not expose a dedicated video-controls extension point, so a limited DOM integration enables controls for plugin-owned video slides and pauses videos when you leave them. Photo rendering and actions remain native.

After opening a gallery, check the extension point in the browser console:

```js
typeof window.PluginApi?.components?.GalleryImagesPanel
// Expected: "function"
```

If this returns `undefined` after the gallery loads, your version does not expose the expected component. Disable the plugin and report your Stash version so the integration can be adapted.

## Updating and removing

For package-source installations, use Stash's plugin manager to check for and install updates. For manual installations, replace all four files and reload plugins. **Fully reload the browser in both cases.**

To remove the plugin, disable it or delete its `gallery-stashapp` directory, then reload plugins and the page. The plugin does not modify the database when loading the mixed list, so there are no migrations or associations to clean up.

## Current limitations

- Does not create galleries for folders that contain only videos; enhances existing folder-based galleries.
- Does not include videos from subfolders, ZIPs, or files that have not been indexed.
- Reloads data when you open the grid or click **Refresh**. After scanning new media while a gallery is open, click that button.
- Search and sorting are local. Media metadata is fetched in batches of 250, and only the visible page renders thumbnails. Very large galleries still need to load all metadata to sort and paginate photos and videos together.
- Uses the browser's HTML5 video player. MP4/WebM and other formats depend on browser support and Stash's streaming/FFmpeg configuration. No additional playback library is supplied for HLS/DASH; select a compatible stream when necessary.
- Uses Stash's native lightbox and slideshow. Chapters are omitted in mixed mode because native chapter indexes count only images. The slideshow uses the native interval, not each video's duration.
- Does not implement advanced scene-player features, play counts, or video progress history. Stash may generate/transcode media when serving streams, depending on its configuration.
- If a scene has multiple files/versions, one matching file is enough for inclusion; playback uses the version selected by Stash.
- Mixed mode is view-only in the grid, without bulk selection, but preserves native image actions in the lightbox. The list refreshes when that viewer closes to reflect changes.
- The mixed-list toolbar is not Stash's full advanced-filter toolbar. Native selection, advanced filters, bulk editing, cover changes, and removal remain available through **Original tools**.

## Troubleshooting

**The plugin does not appear in Settings → Plugins:** check the configuration directory and make sure the `.yml` manifest and its assets were copied together.

**The grid has not changed:** fully reload the page, make sure UI customizations are enabled, and look for `[gallery-stashapp]` messages in the console. Check the extension point described under compatibility.

**Only photos appear:** check that the gallery is folder-based and videos have been indexed in that exact folder, without exclusions. Click **Refresh** after scanning.

**GraphQL/unknown-field error:** use **Original tools** and report your Stash version and the error message. Your installed version may not provide the required schema.

**React error #130:** install the latest package, reload plugins, and fully reload the page. Release `0.2.1` corrected patch argument handling, including React's context argument. If the error persists, report the installed plugin version, Stash version, full console error, and whether other gallery plugins are enabled. Do not assume passing simulated tests proves the installed integration is working.

**Video does not play:** try another option in the **Quality** selector or use **Open scene player**, especially for HLS/DASH. Check Stash's FFmpeg and streaming configuration. The ←/→ keys still navigate between media; use the video controls to seek within a video.

## Development and tests

Node.js 20+ is required only for development and testing:

```bash
npm ci
npm run check
npm test
```

Tests cover paginated queries, exact-folder matching, mixed media, sorting, filtering, cancellation, gallery changes, errors, native fallbacks, component integration, and photo → video → photo navigation with keyboard/on-screen arrows, including page changes. They also verify that scene IDs are never supplied to image actions, patch hooks handle React's context argument, direct/original streams take priority, and quality changes preserve playback state. The UI host is simulated; zoom, gestures, playback, and focus must still be checked in a real Stash browser session.

To validate queries against a local Stash schema checkout as well:

```bash
STASH_SCHEMA_DIR=/path/to/stash/graphql/schema npm test
```

A checkout at `../stash` is used automatically if present. Without a local schema or the environment variable, only the schema-validation test is skipped. CI runs against the `v0.31.1` and `develop` schemas.

### Publishing an installable package

After changing the plugin:

1. Update the version in `package.json`, `package-lock.json`, and `gallery-stashapp.yml`. Keep the README's manifest example in sync.
2. Update `RELEASE_DATE` in `scripts/package.cjs` (UTC, `YYYY-MM-DD HH:mm:ss`). Stash compares release dates when checking for updates.
3. Run `npm run package` and `npm test`.
4. Commit `index.yml`, the generated ZIP in `dist/`, and the source changes, then push to `main`.

The package is reproducible, includes only runtime files and the license, and uses a version-and-hash-based filename. Keep previous release ZIPs unchanged and available: a cached index may still point to them. Older archives retain their original language; the latest source and package use English. The installation source remains the same `index.yml` URL.

### Manual test checklist

1. Use a test gallery with at least one photo and one video in the same folder.
2. Scan the folder, open the gallery, and check that photos and videos appear together.
3. Verify that a video from a subfolder does not appear.
4. Open a photo and check the native lightbox, zoom, settings, and image actions.
5. Use ←/→ and on-screen arrows to navigate photo → video → photo, including across pages. For videos, check controls, the default **Original / Direct stream** selection, alternative qualities, and the absence of image deletion/rating actions; videos should pause when you leave them. Switch quality while playing and while paused, check position/playback rate, and test **Open scene player**.
6. Test **Esc**, grid/wall, thumbnail size, search, media types, sorting, pagination, and **Original tools**.
7. Scan new media and click **Refresh**.
8. Open a ZIP gallery: it should retain the original interface.
9. Disable the plugin and reload the page: the original interface should return without data changes, except actions you deliberately performed through native tools.
10. Check the browser console for errors throughout the test. Do not treat the release as browser-verified until this checklist passes on the installed Stash version.

## License

MIT. An independent project, not an official Stash plugin.
