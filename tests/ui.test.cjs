const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { parse } = require('graphql');
const React = require('react');
const { act } = require('react-dom/test-utils');
const ReactDOM = require('react-dom');
const h = React.createElement;

// A small host contract fixture, not a copy of Stash's implementation. It models
// the public patch points, native ImageList props and native Lightbox DOM used by
// the plugin. Real-browser testing in Stash is still necessary.
let dom, container, replacement, afterPatches, calls, handler, nativeProps, mutations, pauses, legacyFooter;
const gallery = { id: '9', updated_at: '2026-01-01', folder: { id: '10', path: '/album' } };
const photo = { id: '1', title: 'Photo', rating100: 80, o_counter: 2, tags: [{ id: 'tag', name: 'Example' }],
  galleries: [], performers: [], paths: { thumbnail: '/thumbnail/1', preview: '', image: '/image/1' },
  visual_files: [{ __typename: 'ImageFile', path: '/album/1.jpg', basename: '1.jpg',
    width: 600, height: 800, parent_folder: { id: '10' } }] };
const video = { id: '1', title: 'Video', paths: { screenshot: '/screenshot/1', stream: '/stream/1' },
  files: [{ path: '/album/2.mp4', basename: '2.mp4', duration: 65, width: 1920, height: 1080,
    video_codec: 'h264', parent_folder: { id: '10' } }] };

async function defaultHandler(options) {
  const operation = options.query.definitions[0].name.value;
  if (operation === 'GalleryStashappImages') return { data: { findImages: { count: 1, images: [photo] } } };
  if (operation === 'GalleryStashappScenes') return { data: { findScenes: { count: 1, scenes: [video] } } };
  return { data: { findScene: { id: '1', sceneStreams: [
    { url: '/stream/1.mp4', mime_type: 'video/mp4', label: 'MP4' },
    { url: '/stream/1.webm', mime_type: 'video/webm', label: 'WebM' },
  ] } } };
}
// Stash appends the patch payload after ALL component arguments. React 17
// supplies (props, context), so the payload is not necessarily argument two.
function after(name, args, rendered) { return afterPatches[name]?.(...args, rendered) || rendered; }
function Original() { return h('p', { 'data-native': true }, 'Native tools'); }
function PatchedPanel(...args) { return replacement(...args, Original); }

function GridCard(props) {
  return h('article', { className: 'image-card grid-card' },
    props.onSelectedChanged && h('input', { type: 'checkbox' }),
    h('div', { className: 'thumbnail-section' },
      h('a', { href: props.url, className: 'image-card-link' }, props.image)),
    h('a', { href: props.url }, props.title), props.details, props.popovers);
}
function NativeCard(props, context) {
  const preview = h('div', { className: 'image-card-preview' },
    h('img', { src: props.image.paths.thumbnail, alt: props.image.title }),
    h('button', { type: 'button', onClick: props.onPreview }, 'Preview'));
  const rendered = h(GridCard, { url: `/images/${props.image.id}`, title: props.image.title,
    onSelectedChanged: () => {}, image: after('ImageCard.Image', [props, context], preview),
    details: h('small', null, 'Native details'),
    popovers: h('span', { className: 'native-tags' }, props.image.tags.map(tag => tag.name).join(', ')) });
  return after('ImageCard', [props, context], rendered);
}
function NativeRenderer({ images, onPreview, mode }) {
  if (mode === 2) return h('div', { className: 'gallery native-wall' }, images.map((image, index) =>
    h('div', { key: image.id, className: 'wall-item', onClick: event => onPreview(index, event) },
      h('img', { src: image.paths.thumbnail, alt: image.title }))));
  return h('div', { className: 'row justify-content-center native-grid' }, images.map((image, index) =>
    h(NativeCard, { key: image.id, image, onPreview: event => onPreview(index, event) })));
}
function NativePagination(props) {
  return h('div', { className: 'native-pagination' },
    h('button', { disabled: props.currentPage <= 1, 'aria-label': 'Previous page',
      onClick: () => props.onChangePage(props.currentPage - 1) }, '←'),
    h('span', null, props.currentPage),
    h('button', { disabled: props.currentPage * props.itemsPerPage >= props.totalItems,
      'aria-label': 'Next page', onClick: () => props.onChangePage(props.currentPage + 1) }, '→'));
}
function NativePaginationIndex(props) {
  const first = props.totalItems ? (props.currentPage - 1) * props.itemsPerPage + 1 : 0;
  const last = Math.min(props.currentPage * props.itemsPerPage, props.totalItems);
  return h('span', null, `${first}–${last} of ${props.totalItems}`);
}
function NativeImageList(props, context) {
  nativeProps = props;
  const [index, setIndex] = React.useState(null);
  const pending = React.useRef(null);
  const previousPage = React.useRef(props.filter.currentPage);
  const lastD = React.useRef(false);
  function close() { setIndex(null); props.setSlideshowRunning(false); }
  function move(direction) {
    if (index === null || pending.current !== null) return;
    const target = index + direction;
    if (target >= 0 && target < props.images.length) { setIndex(target); return; }
    if (props.pageCount > 1) {
      pending.current = direction;
      const nextPage = props.filter.currentPage + direction;
      props.onChangePage(nextPage < 1 ? props.pageCount : nextPage > props.pageCount ? 1 : nextPage);
    } else setIndex(target < 0 ? props.images.length - 1 : 0);
  }
  React.useEffect(() => {
    if (previousPage.current !== props.filter.currentPage && pending.current !== null) {
      setIndex(pending.current < 0 ? props.images.length - 1 : 0);
      pending.current = null;
    }
    previousPage.current = props.filter.currentPage;
  }, [props.filter.currentPage, props.images]);
  React.useEffect(() => {
    if (index === null) return;
    const onKey = event => {
      if (event.key === 'ArrowRight') move(1);
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'Escape') close();
      if (event.key === 'd' && props.images[index]?.id !== undefined) {
        if (lastD.current) mutations.push({ type: 'delete-image', id: props.images[index].id });
        lastD.current = true;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  const rendered = h(NativeRenderer, { images: props.images, mode: props.filter.displayMode,
    onPreview: (selected, event) => { event?.preventDefault(); setIndex(selected); props.setSlideshowRunning(true); } });
  const current = props.images[index];
  const modal = index !== null && current && h('div', { className: 'Lightbox', role: 'dialog' },
    h('div', { className: 'Lightbox-header-right' },
      h('button', { title: 'Native zoom' }, 'Zoom'),
      h('button', { title: 'Native options' }, 'Settings'),
      h('button', { title: 'Close Lightbox', onClick: close }, 'Close')),
    h('div', { className: 'Lightbox-display' },
      h('button', { 'aria-label': 'Previous media', onClick: () => move(-1) }, 'Previous'),
      h('div', { className: 'Lightbox-carousel', style: { left: `${index * -100}vw` } },
        props.images.map(image => h('div', { className: 'Lightbox-carousel-image', key: image.paths.image },
          image.visual_files[0]?.__typename === 'VideoFile'
            ? h('video', { src: image.paths.image }) : h('img', { src: image.paths.image, alt: image.title })))),
      h('button', { 'aria-label': 'Next media', onClick: () => move(1) }, 'Next')),
    h('div', { className: 'Lightbox-footer' },
      h('div', { className: 'Lightbox-footer-left' }, current.id !== undefined &&
        h('button', { 'data-image-rating': true,
          onClick: () => mutations.push({ type: 'rate-image', id: current.id }) }, `Rate ${current.rating100}`)),
      h('div', { className: 'Lightbox-footer-center' },
        h(legacyFooter ? React.Fragment : 'div', legacyFooter ? null : { className: 'd-flex' },
          h('a', { className: 'image-link', href: `/images/${current.id}` }, current.title),
          current.id !== undefined && h('button', { 'data-image-delete': true,
            onClick: () => mutations.push({ type: 'delete-image', id: current.id }) }, 'Delete image'))),
      h('div', { className: 'Lightbox-footer-right' })));
  return h(React.Fragment, null, after('ImageList', [props, context], rendered), modal);
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost:9999/galleries/9', runScripts: 'outside-only',
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  pauses = [];
  window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function () { pauses.push(this.getAttribute('src')); };
  container = document.getElementById('root');
  calls = []; mutations = []; afterPatches = {}; nativeProps = null; legacyFooter = false;
  const style = document.createElement('style');
  style.textContent = fs.readFileSync(path.join(__dirname, '..', 'gallery-stashapp.css'), 'utf8');
  document.head.appendChild(style);
  handler = defaultHandler;
  window.PluginApi = {
    React, ReactDOM,
    libraries: { Apollo: { gql: parse } },
    components: { ImageList: NativeImageList, Pagination: NativePagination, PaginationIndex: NativePaginationIndex },
    utils: { StashService: { getClient: () => ({ query: options => { calls.push(options); return handler(options); } }) } },
    patch: {
      instead: (name, fn) => { assert.equal(name, 'GalleryImagesPanel'); replacement = fn; },
      after: (name, fn) => { afterPatches[name] = fn; },
    },
  };
  for (const file of ['gallery-core.js', 'gallery-stashapp.js']) {
    window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  }
});

afterEach(async () => {
  await act(async () => { ReactDOM.unmountComponentAtNode(container); });
  dom.window.close();
  delete global.window; delete global.document; delete global.MutationObserver;
});
async function settle() { await new Promise(resolve => setImmediate(resolve)); }
async function render(value = gallery, active = true) {
  await act(async () => { ReactDOM.render(h(PatchedPanel, { gallery: value, active }), container); await settle(); });
}
async function click(element) {
  assert.ok(element, 'expected a clickable element');
  await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); await settle(); });
}
async function key(name, target = document) {
  await act(async () => { target.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); await settle(); });
}
function button(text) { return Array.from(container.querySelectorAll('button')).find(item => item.textContent === text); }
function card(title) { return Array.from(container.querySelectorAll('.image-card-link')).find(link => link.querySelector('img')?.alt === title); }

test('uses the host image cards, pagination and lightbox without database mutations', async () => {
  await render();
  assert.equal(container.querySelectorAll('.image-card').length, 2);
  assert.ok(container.querySelector('.native-grid'));
  assert.ok(container.querySelector('.native-pagination'));
  assert.equal(container.querySelectorAll('.image-card input[type="checkbox"]').length, 0);
  assert.match(container.textContent, /1 image · 1 video/);
  assert.match(container.textContent, /Example/);
  assert.match(container.textContent, /1:05/);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.query.definitions[0].operation, 'query');
    assert.equal(call.fetchPolicy, 'no-cache');
  }
});

test('renders English toolbar labels and filter choices', async () => {
  await render();
  assert.ok(container.querySelector('[aria-label="Gallery photos and videos"]'));
  for (const label of ['Search media', 'Media type', 'Sort order', 'Reverse sort order',
    'Items per page', 'Grid', 'Wall', 'Thumbnail size']) {
    assert.ok(container.querySelector(`[aria-label="${label}"]`), `missing English label: ${label}`);
  }
  assert.deepEqual(Array.from(container.querySelector('[aria-label="Media type"]').options,
    option => option.textContent), ['Photos and videos', 'Images only', 'Videos only']);
  assert.ok(button('Refresh'));
  assert.ok(button('Original tools'));
});

test('renders English plural counts and an empty-filter message', async () => {
  handler = async options => options.query.definitions[0].name.value === 'GalleryStashappImages'
    ? { data: { findImages: { count: 2, images: [photo, { ...photo, id: '2' }] } } }
    : { data: { findScenes: { count: 0, scenes: [] } } };
  await render();
  assert.equal(container.querySelector('.gs-counts').textContent, '2 images · 0 videos');
  assert.match(container.querySelector('.gs-hint').textContent, /No videos are indexed in this folder/);
  await act(async () => {
    const select = container.querySelector('[aria-label="Media type"]');
    select.value = 'video';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  assert.match(container.textContent, /No media found with these filters/);
});

test('keeps images real and gives videos no image ID, even when numeric IDs collide', async () => {
  await render();
  assert.equal(nativeProps.images[0].id, '1');
  assert.equal(nativeProps.images[0].rating100, 80);
  assert.equal(nativeProps.images[1].id, undefined);
  assert.equal(nativeProps.images[1]._gsNative.id, '1');
  assert.equal(nativeProps.images[1].visual_files[0].__typename, 'VideoFile');
  assert.deepEqual(mutations, []);
});

test('preserves the original panel for archives and galleries without a folder', async () => {
  await render({ id: 'zip', folder: null });
  assert.ok(container.querySelector('[data-native]'));
  assert.equal(calls.length, 0);
});

test('does not query while the panel is inactive', async () => {
  await render(gallery, false);
  assert.equal(calls.length, 0);
});

test('allows switching to the complete native tools and back', async () => {
  await render();
  await click(button('Original tools'));
  assert.ok(container.querySelector('[data-native]'));
  await click(button('Show photos and videos'));
  assert.equal(container.querySelectorAll('.image-card').length, 2);
});

test('opens photos in the native lightbox with native image controls', async () => {
  await render();
  await click(card('Photo'));
  assert.ok(container.querySelector('.Lightbox'));
  assert.ok(container.querySelector('[title="Native zoom"]'));
  assert.ok(container.querySelector('[title="Native options"]'));
  assert.ok(container.querySelector('[data-image-delete]'));
  assert.ok(container.querySelector('[data-image-rating]'));
  assert.equal(container.querySelector('.Lightbox .image-link').getAttribute('href'), '/images/1');
  assert.equal(container.querySelectorAll('.gs-media-modal').length, 0);
});

test('navigates photo → video → photo using native left/right keyboard navigation', async () => {
  await render();
  await click(card('Photo'));
  await key('ArrowRight');
  const player = container.querySelector('.Lightbox video');
  assert.ok(container.querySelector('.Lightbox.gs-native-video-active'));
  assert.equal(player.controls, true);
  assert.match(player.getAttribute('src'), /\/stream\/1.mp4#gs-scene=1$/);
  assert.equal(container.querySelectorAll('.gs-native-video-controls option').length, 2);
  assert.equal(container.querySelector('[data-image-delete]'), null);
  await key('d'); await key('d');
  assert.deepEqual(mutations, [], 'video IDs must never reach image mutations');
  await key('ArrowLeft');
  assert.ok(container.querySelector('.Lightbox:not(.gs-native-video-active)'));
  assert.ok(container.querySelector('[data-image-rating]'));
  assert.ok(pauses.some(src => src.includes('/stream/1.mp4')));
  assert.equal(window.location.pathname, '/galleries/9');
});

test('uses native on-screen arrows and supports opening a video card directly', async () => {
  await render();
  await click(card('Video'));
  assert.ok(container.querySelector('.gs-native-video-title'));
  await click(container.querySelector('[aria-label="Previous media"]'));
  assert.ok(container.querySelector('[data-image-delete]'));
  await click(container.querySelector('[aria-label="Next media"]'));
  assert.ok(container.querySelector('.Lightbox.gs-native-video-active'));
});

test('continues native keyboard navigation when the video itself has focus', async () => {
  await render();
  await click(card('Video'));
  await key('ArrowLeft', container.querySelector('video'));
  assert.ok(container.querySelector('[data-image-rating]'));
});

test('video controls and stream selection do not accidentally navigate to another slide', async () => {
  await render();
  await click(card('Video'));
  const select = container.querySelector('[aria-label="Video stream"]');
  await key('ArrowLeft', select);
  assert.ok(container.querySelector('.Lightbox.gs-native-video-active'));
  await act(async () => {
    select.value = '/stream/1.webm';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  const player = container.querySelector('video');
  assert.match(player.getAttribute('src'), /1.webm#gs-scene=1$/);
  await click(player);
  assert.ok(container.querySelector('.Lightbox.gs-native-video-active'));
});

test('defaults to Original and offers the native stream labels and resolutions', async () => {
  const streams = [
    { url: '/scene/1/stream.mp4?resolution=LOW', mime_type: 'video/mp4', label: 'MP4 Low (240p)' },
    { url: '/scene/1/stream.mp4?resolution=ORIGINAL', mime_type: 'video/mp4', label: 'MP4' },
    { url: '/scene/1/stream?token=example', mime_type: 'video/mp4', label: 'Direct stream' },
    { url: '/scene/1/stream.mp4?resolution=STANDARD_HD', mime_type: 'video/mp4', label: 'MP4 HD (720p)' },
    { url: '/scene/1/stream.m3u8?resolution=ORIGINAL', mime_type: 'application/x-mpegURL', label: 'HLS' },
  ];
  handler = options => options.query.definitions[0].name.value === 'GalleryStashappStreams'
    ? Promise.resolve({ data: { findScene: { sceneStreams: streams } } }) : defaultHandler(options);
  await render();
  await click(card('Video'));
  const select = container.querySelector('[aria-label="Video stream"]');
  assert.equal(select.value, '/scene/1/stream?token=example');
  assert.deepEqual(Array.from(select.options, option => option.textContent), [
    'Original / Direct stream', 'MP4 (Original resolution)', 'HLS (Original resolution)',
    'MP4 HD (720p)', 'MP4 Low (240p)',
  ]);
  assert.equal(container.querySelector('video').getAttribute('src'), '/scene/1/stream?token=example#gs-scene=1');
  assert.equal(container.querySelector('.gs-scene-player-link').getAttribute('href'), '/scenes/1');
  assert.deepEqual(mutations, []);
});

test('shows the selected quality even if only an original stream is available', async () => {
  handler = options => options.query.definitions[0].name.value === 'GalleryStashappStreams'
    ? Promise.resolve({ data: { findScene: { sceneStreams: [{ url: '/scene/1/stream', label: 'Direct stream' }] } } })
    : defaultHandler(options);
  await render();
  await click(card('Video'));
  const select = container.querySelector('[aria-label="Video stream"]');
  assert.equal(select.options.length, 1);
  assert.equal(select.selectedOptions[0].textContent, 'Original / Direct stream');
});

test('changing quality preserves position, playback rate and pause state after metadata loads', async () => {
  await render();
  await click(card('Video'));
  const player = container.querySelector('video');
  const select = container.querySelector('[aria-label="Video stream"]');
  player.currentTime = 27;
  player.playbackRate = 1.5;
  await act(async () => {
    select.value = '/stream/1.webm';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    player.currentTime = 0;
    player.playbackRate = 1;
    player.dispatchEvent(new window.Event('loadedmetadata'));
  });
  assert.equal(player.currentTime, 27);
  assert.equal(player.playbackRate, 1.5);
  assert.ok(player.paused);
  assert.ok(pauses.some(src => src.includes('/stream/1.webm')));
});

test('changing quality resumes a playing video instead of leaving it paused', async (t) => {
  await render();
  await click(card('Video'));
  const player = container.querySelector('video');
  const select = container.querySelector('[aria-label="Video stream"]');
  Object.defineProperty(player, 'paused', { configurable: true, get: () => false });
  const play = t.mock.method(player, 'play', () => Promise.resolve());
  const pause = t.mock.method(player, 'pause', () => {});
  player.currentTime = 12;
  await act(async () => {
    select.value = '/stream/1.webm';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    player.currentTime = 0;
    player.dispatchEvent(new window.Event('loadedmetadata'));
  });
  assert.equal(player.currentTime, 12);
  assert.equal(play.mock.callCount(), 1);
  assert.equal(pause.mock.callCount(), 0);
});

test('only the latest quality switch can restore position and leaving the video removes the listener', async () => {
  await render();
  await click(card('Video'));
  const player = container.querySelector('video');
  const select = container.querySelector('[aria-label="Video stream"]');
  await act(async () => {
    player.currentTime = 10;
    select.value = '/stream/1.webm';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    player.currentTime = 35;
    select.value = '/stream/1.mp4';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    player.currentTime = 0;
    player.dispatchEvent(new window.Event('loadedmetadata'));
  });
  assert.equal(player.currentTime, 35);
  await act(async () => {
    select.value = '/stream/1.webm';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await key('ArrowLeft');
  player.currentTime = 0;
  await act(async () => { player.dispatchEvent(new window.Event('loadedmetadata')); });
  assert.equal(player.currentTime, 0);
});

test('an unsupported original reports an error without silently switching to a lower quality', async () => {
  handler = options => options.query.definitions[0].name.value === 'GalleryStashappStreams'
    ? Promise.resolve({ data: { findScene: { sceneStreams: [
      { url: '/scene/1/stream', mime_type: 'video/mp4', label: 'Direct stream' },
      { url: '/scene/1/stream.mp4?resolution=LOW', mime_type: 'video/mp4', label: 'MP4 Low (240p)' },
    ] } } }) : defaultHandler(options);
  await render();
  await click(card('Video'));
  await act(async () => { container.querySelector('video').dispatchEvent(new window.Event('error')); });
  assert.equal(container.querySelector('[aria-label="Video stream"]').value, '/scene/1/stream');
  assert.match(container.querySelector('.gs-native-video-controls [role="alert"]').textContent, /Try another quality/);
  assert.ok(container.querySelector('.gs-scene-player-link'));
});

test('hides image-only links for videos in the v0.31.1 footer layout and restores them for photos', async () => {
  legacyFooter = true;
  await render();
  await click(card('Video'));
  const link = container.querySelector('.Lightbox-footer-center > .image-link');
  assert.ok(link);
  assert.equal(window.getComputedStyle(link).display, 'none');
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => { link.dispatchEvent(event); });
  assert.equal(event.defaultPrevented, true);
  await key('ArrowLeft');
  assert.notEqual(window.getComputedStyle(container.querySelector('.image-link')).display, 'none');
});

test('native Escape closes the viewer and refreshes edited images', async () => {
  await render();
  await click(card('Photo'));
  await key('Escape');
  assert.equal(container.querySelector('.Lightbox'), null);
  assert.equal(calls.length, 4);
});

test('preserves native wall rendering and opens videos from it', async () => {
  await render();
  await click(container.querySelector('[aria-label="Wall"]'));
  assert.equal(container.querySelectorAll('.native-wall .wall-item').length, 2);
  await click(container.querySelector('img[alt="Video"]'));
  assert.ok(container.querySelector('.Lightbox.gs-native-video-active'));
});

test('refreshes indexed media without a scan hook', async () => {
  await render();
  await click(button('Refresh'));
  assert.equal(calls.length, 4);
});

test('reports GraphQL errors and keeps native tools accessible', async () => {
  handler = async () => ({ errors: [{ message: 'Field unavailable in this version' }] });
  await render();
  assert.match(container.querySelector('[role="alert"]').textContent, /Field unavailable/);
  await click(button('Original tools'));
  assert.ok(container.querySelector('[data-native]'));
});

test('does not display stale results after navigation to a different gallery', async () => {
  let resolveOldImages;
  handler = options => options.variables.gallery === '9'
    ? new Promise(resolve => { resolveOldImages = resolve; }) : defaultHandler(options);
  await render();
  const oldSignal = calls.find(call => call.variables.gallery === '9').context.fetchOptions.signal;
  await render({ ...gallery, id: '20', folder: { id: '30', path: '/other' } });
  assert.equal(oldSignal.aborted, true);
  assert.equal(container.querySelectorAll('.image-card').length, 1);
  await act(async () => {
    resolveOldImages({ data: { findImages: { count: 1, images: [{ ...photo, title: 'STALE' }] } } });
    await settle();
  });
  assert.doesNotMatch(container.textContent, /STALE/);
});

test('filters the mixed list while preserving native rendering', async () => {
  await render();
  await act(async () => {
    const select = container.querySelector('[aria-label="Media type"]');
    select.value = 'video';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  assert.equal(container.querySelectorAll('.image-card').length, 1);
  assert.ok(card('Video'));
});

test('paginates mixed media and navigates across page boundaries in the native viewer', async () => {
  handler = options => {
    if (options.query.definitions[0].name.value !== 'GalleryStashappImages') return defaultHandler(options);
    const images = Array.from({ length: 40 }, (_, index) => ({ ...photo, id: String(index + 1), title: `Photo ${index + 1}`,
      paths: { thumbnail: `/thumbnail/${index + 1}`, preview: '', image: `/image/${index + 1}` } }));
    return Promise.resolve({ data: { findImages: { count: images.length, images } } });
  };
  await render();
  assert.equal(container.querySelectorAll('.image-card').length, 40);
  await click(container.querySelectorAll('.image-card-link')[39]);
  await key('ArrowRight');
  assert.equal(container.querySelectorAll('.image-card').length, 1);
  assert.match(container.textContent, /41–41 of 41/);
  assert.ok(container.querySelector('.Lightbox.gs-native-video-active'));
  await key('ArrowLeft');
  assert.equal(container.querySelectorAll('.image-card').length, 40);
  assert.ok(container.querySelector('[data-image-rating]'));
});

test('reports missing video streams without replacing the native viewer', async () => {
  handler = options => options.query.definitions[0].name.value === 'GalleryStashappStreams'
    ? Promise.resolve({ data: { findScene: { sceneStreams: [] } } }) : defaultHandler(options);
  await render();
  await click(card('Video'));
  assert.match(container.querySelector('.Lightbox').textContent, /did not provide a stream/);
  await key('ArrowLeft');
  assert.ok(container.querySelector('[data-image-rating]'));
});

test('renders untrusted metadata as text', async () => {
  handler = options => options.query.definitions[0].name.value === 'GalleryStashappImages'
    ? Promise.resolve({ data: { findImages: { count: 1,
      images: [{ ...photo, title: '<img src=x onerror="alert(1)">' }] } } }) : defaultHandler(options);
  await render();
  assert.ok(container.textContent.includes('<img src=x onerror="alert(1)">'));
  assert.equal(container.querySelectorAll('[onerror]').length, 0);
});

test('falls back safely when native components are unavailable', async () => {
  delete window.PluginApi.components.ImageList;
  await render();
  assert.ok(container.querySelector('[data-native]'));
  assert.match(container.querySelector('[role="alert"]').textContent, /does not expose the required native grid/);
});

test('the error boundary can render the original panel after a native component throws', async (t) => {
  t.mock.method(console, 'error', () => {});
  window.PluginApi.components.Pagination = function BrokenPagination() { throw new Error('Native render failed'); };
  await render();
  assert.ok(container.querySelector('[data-native]'));
  assert.match(container.querySelector('[role="alert"]').textContent, /The plugin encountered an error/);
});

test('also accepts patch calls without React context', async () => {
  await act(async () => {
    ReactDOM.render(replacement({ gallery: { id: 'zip', folder: null } }, Original), container);
  });
  assert.ok(container.querySelector('[data-native]'));
  const props = { _gsMixed: true, images: [], image: { _gsNative: { kind: 'video', id: '1' } } };
  const rendered = h('div', { 'data-preview': true });
  assert.deepEqual(afterPatches.ImageList(props, rendered).props.images, []);
  assert.equal(afterPatches.ImageCard(props, rendered).props.className, 'gs-native-card-shell');
  const preview = afterPatches['ImageCard.Image'](props, rendered);
  assert.equal(preview.props.children[0], rendered);
  assert.equal(preview.props.children[1].props.className, 'gs-native-play');
});

test('only registers the plugin once', async () => {
  window.PluginApi.patch.instead = () => assert.fail('duplicate registration');
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'gallery-stashapp.js'), 'utf8'));
  await render();
  assert.equal(container.querySelectorAll('.image-card').length, 2);
});
