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

let dom, container, patch, calls, handler;
const gallery = { id: '9', updated_at: '2026-01-01', folder: { id: '10', path: '/album' } };
const photo = { id: '1', title: 'Foto', paths: { thumbnail: '/thumbnail/1', image: '/image/1' },
  visual_files: [{ path: '/album/1.jpg', basename: '1.jpg', parent_folder: { id: '10' } }] };
const video = { id: '1', title: 'Vídeo', paths: { screenshot: '/screenshot/1' },
  files: [{ path: '/album/2.mp4', basename: '2.mp4', duration: 65, parent_folder: { id: '10' } }] };

async function defaultHandler(options) {
  const operation = options.query.definitions[0].name.value;
  if (operation === 'GalleryStashappImages') return { data: { findImages: { count: 1, images: [photo] } } };
  if (operation === 'GalleryStashappScenes') return { data: { findScenes: { count: 1, scenes: [video] } } };
  return { data: { findScene: { id: '1', sceneStreams: [
    { url: '/stream/1.mp4', mime_type: 'video/mp4', label: 'MP4' },
    { url: '/stream/1.webm', mime_type: 'video/webm', label: 'WebM' },
  ] } } };
}

function Original() { return h('p', { 'data-native': true }, 'Grade nativa'); }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost:9999/galleries/9', runScripts: 'outside-only',
  });
  global.window = dom.window;
  global.document = dom.window.document;
  container = document.getElementById('root');
  calls = [];
  handler = defaultHandler;
  const Modal = ({ show, children, onKeyDown }) => show ? h('div', { role: 'dialog', onKeyDown }, children) : null;
  Modal.Header = ({ children }) => h('header', null, children);
  Modal.Title = ({ children, id }) => h('h2', { id }, children);
  Modal.Body = ({ children }) => h('main', null, children);
  Modal.Footer = ({ children }) => h('footer', null, children);
  window.PluginApi = {
    React,
    libraries: {
      Apollo: { gql: parse }, Bootstrap: { Modal },
      ReactRouterDOM: { Link: ({ to, children, onClick, className }) => h('a', { href: to, onClick, className }, children) },
    },
    utils: { StashService: { getClient: () => ({ query: (options) => {
      calls.push(options);
      return handler(options);
    } }) } },
    patch: { instead: (name, fn) => { assert.equal(name, 'GalleryImagesPanel'); patch = fn; } },
  };
  for (const file of ['gallery-core.js', 'gallery-stashapp.js']) {
    window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  }
});

afterEach(async () => {
  await act(async () => { ReactDOM.unmountComponentAtNode(container); });
  dom.window.close();
  delete global.window;
  delete global.document;
});

async function render(value = gallery, active = true) {
  await act(async () => {
    ReactDOM.render(patch({ gallery: value, active }, Original), container);
    await new Promise(resolve => setImmediate(resolve));
  });
}
async function click(element) {
  assert.ok(element, 'expected a clickable element');
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
  });
}
function button(text) { return Array.from(container.querySelectorAll('button')).find(item => item.textContent === text); }

test('renders photos and videos together, with no database mutation', async () => {
  await render();
  assert.equal(container.querySelectorAll('.gs-card').length, 2);
  assert.match(container.textContent, /1 imagem · 1 vídeo/);
  assert.match(container.textContent, /1:05/);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.query.definitions[0].operation, 'query');
    assert.equal(call.fetchPolicy, 'no-cache');
    assert.equal(call.context.queryDeduplication, false);
  }
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

test('allows switching to the native panel and back', async () => {
  await render();
  await click(button('Grade original'));
  assert.ok(container.querySelector('[data-native]'));
  assert.equal(container.querySelectorAll('.gs-card').length, 0);
  await click(button('Mostrar fotos e vídeos'));
  assert.equal(container.querySelectorAll('.gs-card').length, 2);
});

test('opens an image and navigates directly to a video in the same modal', async () => {
  await render();
  await click(container.querySelector('[aria-label="Abrir imagem: Foto"]'));
  assert.equal(container.querySelector('.gs-full-image').getAttribute('src'), '/image/1');
  await click(button('Próxima →'));
  assert.ok(container.querySelector('[role="dialog"]'));
  assert.equal(container.querySelector('video').getAttribute('src'), '/stream/1.mp4');
  assert.equal(container.querySelectorAll('.gs-stream-label option').length, 2);
  assert.equal(window.location.pathname, '/galleries/9');
});

test('refreshes indexed media without requiring a scan hook', async () => {
  await render();
  assert.equal(calls.length, 2);
  await click(button('Atualizar'));
  assert.equal(calls.length, 4);
});

test('displays GraphQL errors and keeps the original-panel escape hatch', async () => {
  handler = async () => ({ errors: [{ message: 'Campo indisponível nesta versão' }] });
  await render();
  assert.match(container.querySelector('[role="alert"]').textContent, /Campo indisponível/);
  await click(button('Grade original'));
  assert.ok(container.querySelector('[data-native]'));
});

test('does not display stale results after navigating to a different gallery', async () => {
  let resolveOldImages;
  handler = options => {
    if (options.variables.gallery === '9') return new Promise(resolve => { resolveOldImages = resolve; });
    return defaultHandler(options);
  };
  await render();
  const oldSignal = calls.find(call => call.variables.gallery === '9').context.fetchOptions.signal;
  await render({ ...gallery, id: '20', folder: { id: '30', path: '/other' } });
  assert.equal(oldSignal.aborted, true);
  assert.equal(container.querySelectorAll('.gs-card').length, 1);
  await act(async () => {
    resolveOldImages({ data: { findImages: { count: 1, images: [{ ...photo, title: 'STALE' }] } } });
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.doesNotMatch(container.textContent, /STALE/);
});

test('filters the displayed grid by media type', async () => {
  await render();
  const select = container.querySelectorAll('.gs-toolbar select')[0];
  await act(async () => {
    select.value = 'video';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  assert.equal(container.querySelectorAll('.gs-card').length, 1);
  assert.ok(container.querySelector('[aria-label="Reproduzir vídeo: Vídeo"]'));
});

test('paginates photos and videos together', async () => {
  handler = options => {
    if (options.query.definitions[0].name.value !== 'GalleryStashappImages') return defaultHandler(options);
    const images = Array.from({ length: 44 }, (_, index) => ({ ...photo, id: String(index + 1),
      title: `Foto ${index + 1}` }));
    return Promise.resolve({ data: { findImages: { count: 44, images } } });
  };
  await render();
  assert.equal(container.querySelectorAll('.gs-card').length, 40);
  await click(container.querySelector('[aria-label="Próxima página"]'));
  assert.equal(container.querySelectorAll('.gs-card').length, 5);
  assert.match(container.textContent, /41–45 de 45/);
});

test('reports missing video streams inside the viewer without leaving the gallery', async () => {
  handler = options => options.query.definitions[0].name.value === 'GalleryStashappStreams'
    ? Promise.resolve({ data: { findScene: { sceneStreams: [] } } }) : defaultHandler(options);
  await render();
  await click(container.querySelector('[aria-label="Reproduzir vídeo: Vídeo"]'));
  assert.match(container.querySelector('[role="dialog"]').textContent, /não disponibilizou um stream/);
  assert.equal(window.location.pathname, '/galleries/9');
});

test('renders metadata as text instead of interpreting HTML', async () => {
  handler = options => options.query.definitions[0].name.value === 'GalleryStashappImages'
    ? Promise.resolve({ data: { findImages: { count: 1,
      images: [{ ...photo, title: '<img src=x onerror="alert(1)">' }] } } }) : defaultHandler(options);
  await render();
  assert.ok(container.textContent.includes('<img src=x onerror="alert(1)">'));
  assert.equal(container.querySelectorAll('[onerror]').length, 0);
});

test('only registers the patch once if the script is loaded twice', async () => {
  window.PluginApi.patch.instead = () => assert.fail('duplicate registration');
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'gallery-stashapp.js'), 'utf8'));
  await render();
  assert.equal(container.querySelectorAll('.gs-card').length, 2);
});
