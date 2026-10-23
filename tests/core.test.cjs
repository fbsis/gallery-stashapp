const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSchema, parse, validate } = require('graphql');
const core = require('../gallery-core.js');

function image(id, basename = `photo${id}.jpg`) {
  return { id, title: '', paths: { thumbnail: `/thumb/${id}`, image: `/image/${id}` },
    visual_files: [{ path: `/album/${basename}`, basename, parent_folder: { id: '10' } }] };
}
function scene(id, folder = '10', basename = `video${id}.mp4`) {
  return { id, title: '', paths: { screenshot: `/shot/${id}` },
    files: [{ path: `/album/${basename}`, basename, duration: 65, parent_folder: { id: folder } }] };
}

test('loads gallery images and exact-folder scenes, without any mutation', async () => {
  const calls = [];
  const query = async (document, variables) => {
    calls.push({ document, variables });
    if (document === core.QUERIES.images) return { findImages: { count: 1, images: [image('1')] } };
    return { findScenes: { count: 1, scenes: [scene('1')] } };
  };
  const items = await core.loadMedia(query, 9, 10);
  assert.deepEqual(items.map(item => item.key), ['image:1', 'video:1']);
  assert.equal(calls[0].variables.gallery, '9');
  assert.equal(calls[1].variables.folder, '10');
  assert.match(calls[1].document, /depth: 0/);
  for (const call of calls) assert.equal(parse(call.document).definitions[0].operation, 'query');
});

test('does not match subfolders or similarly named sibling folders', () => {
  const items = core.toMedia([], [scene('a'), scene('b', '11'), scene('c', '100')], '10');
  assert.deepEqual(items.map(item => item.id), ['a']);
});

test('uses the matching video file rather than the first version in another folder', () => {
  const video = scene('a', '11', 'outside.mp4');
  video.files.push(scene('b', '10', 'inside.mp4').files[0]);
  const [item] = core.toMedia([], [video], '10');
  assert.equal(item.title, 'inside.mp4');
  assert.equal(item.path, '/album/inside.mp4');
});

test('preserves gallery image membership, even for manually added images', () => {
  const photo = image('a');
  photo.visual_files[0].parent_folder.id = '99';
  assert.equal(core.toMedia([photo], [], '10').length, 1);
});

test('deduplicates items but keeps an image and scene with the same numeric ID', () => {
  assert.equal(core.toMedia([image('1'), image('1')], [scene('1'), scene('1')], '10').length, 2);
});

test('fetches every server page, including galleries with more than 250 items', async () => {
  const calls = [];
  const data = Array.from({ length: 501 }, (_, index) => image(String(index)));
  const images = await core.fetchAll(async (document, variables) => {
    calls.push(variables.page);
    const offset = (variables.page - 1) * variables.perPage;
    return { findImages: { count: data.length, images: data.slice(offset, offset + variables.perPage) } };
  }, core.QUERIES.images, { gallery: '9' }, 'findImages', 'images');
  assert.equal(images.length, 501);
  assert.deepEqual(calls, [1, 2, 3]);
});

test('returns empty results without requesting another page', async () => {
  let calls = 0;
  assert.deepEqual(await core.fetchAll(async () => {
    calls++;
    return { findScenes: { count: 0, scenes: [] } };
  }, '', {}, 'findScenes', 'scenes'), []);
  assert.equal(calls, 1);
});

test('rejects inconsistent pagination instead of looping forever', async () => {
  await assert.rejects(core.fetchAll(async () => ({ findScenes: { count: 1, scenes: [] } }),
    '', {}, 'findScenes', 'scenes'), /biblioteca mudou/);
});

test('reports missing or malformed server results', async () => {
  await assert.rejects(core.fetchAll(async () => ({}), '', {}, 'findScenes', 'scenes'), /Resposta inesperada/);
  await assert.rejects(core.fetchAll(async () => ({ findScenes: { count: -1, scenes: [] } }),
    '', {}, 'findScenes', 'scenes'), /Resposta inesperada/);
});

test('detects overlapping pages caused by changes to the indexed library', async () => {
  await assert.rejects(core.fetchAll(async () => ({ findScenes: { count: 2, scenes: [scene('1')] } }),
    '', {}, 'findScenes', 'scenes'), /biblioteca mudou/);
});

test('propagates network and GraphQL failures', async () => {
  await assert.rejects(core.loadMedia(async () => { throw new Error('Sem conexão'); }, '1', '10'), /Sem conexão/);
});

test('rejects a gallery without a physical folder', async () => {
  await assert.rejects(core.loadMedia(() => assert.fail('must not query'), '1', null), /associada a uma pasta/);
});

test('honors cancellation before querying', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(core.loadMedia(() => assert.fail('must not query'), '1', '10', controller.signal),
    { name: 'AbortError' });
});

test('honors cancellation between pages', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(core.fetchAll(async () => {
    calls++;
    controller.abort();
    return { findScenes: { count: 2, scenes: [scene('a')] } };
  }, '', {}, 'findScenes', 'scenes', controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('sorts mixed media by path with natural filename ordering', () => {
  const items = core.toMedia([image('10'), image('2')], [scene('1')], '10');
  assert.deepEqual(core.selectMedia(items).map(item => item.title), ['photo2.jpg', 'photo10.jpg', 'video1.mp4']);
  assert.deepEqual(items.map(item => item.title), ['photo10.jpg', 'photo2.jpg', 'video1.mp4']);
});

test('supports search, media type, title sorting and descending order', () => {
  const items = core.toMedia([image('a')], [scene('b'), scene('c')], '10');
  assert.equal(core.selectMedia(items, { kind: 'video' }).length, 2);
  assert.equal(core.selectMedia(items, { search: ' VIDEOb ' })[0].id, 'b');
  assert.equal(core.selectMedia(items, { search: 'missing' }).length, 0);
  assert.deepEqual(core.selectMedia(items, { kind: 'video', sort: 'title', descending: true })
    .map(item => item.id), ['c', 'b']);
});

test('paginates the combined list, clamps pages and handles empty results', () => {
  const items = Array.from({ length: 45 }, (_, i) => i);
  assert.deepEqual(core.paginate(items, 99, 40), {
    items: [40, 41, 42, 43, 44], page: 2, pages: 2, total: 45, first: 41, last: 45,
  });
  assert.equal(core.paginate(items, -1, 40).page, 1);
  assert.equal(core.paginate(items, 1, 0).items.length, 40);
  assert.deepEqual(core.paginate([], 1, 40), { items: [], page: 1, pages: 1, total: 0, first: 0, last: 0 });
});

test('formats video durations without treating missing duration as zero', () => {
  assert.equal(core.formatDuration(65.9), '1:05');
  assert.equal(core.formatDuration(3661), '1:01:01');
  assert.equal(core.formatDuration(0), '0:00');
  assert.equal(core.formatDuration(null), '');
  assert.equal(core.formatDuration(-1), '');
});

test('deduplicates stream endpoints and ignores empty URLs', () => {
  const streams = [{ url: '/a', label: 'MP4' }, { url: '/a' }, { url: '' }, { url: '/b' }];
  assert.deepEqual(core.streamChoices(streams).map(stream => stream.url), ['/a', '/b']);
});

test('native photo entries preserve real IDs, metadata and original image paths', () => {
  const original = { ...image('1'), rating100: 80, o_counter: 4, tags: [{ id: '2', name: 'Example' }] };
  const [entry] = core.nativeEntries(core.toMedia([original], [], '10'));
  assert.equal(entry.id, '1');
  assert.equal(entry.rating100, 80);
  assert.equal(entry.o_counter, 4);
  assert.deepEqual(entry.tags, original.tags);
  assert.equal(entry.paths.image, original.paths.image);
  assert.equal(entry.paths.preview, '');
  assert.equal(original._gsNative, undefined, 'do not mutate server data');
});

test('native video slides have no image ID and cannot target an unrelated image', () => {
  const original = scene('1');
  original.paths.stream = '/scene/1/stream';
  const entries = core.nativeEntries(core.toMedia([image('1')], [original], '10'));
  assert.equal(entries[0].id, '1');
  assert.equal(entries[1].id, undefined);
  assert.equal(entries[1]._gsNative.id, '1');
  assert.equal(entries[1].visual_files[0].__typename, 'VideoFile');
  assert.equal(entries[1].rating100, undefined);
  assert.equal(entries[1].o_counter, undefined);
  assert.equal(entries[1].paths.image, '/scene/1/stream#gs-scene=1');
  const cards = core.gridEntries(entries);
  assert.equal(cards[1].id, 'gs-video:1');
  assert.equal(entries[1].id, undefined, 'display keys must not leak into lightbox entries');
});

test('video markers are round-trippable and cannot be confused with normal photo paths', () => {
  const id = 'scene & 1';
  assert.equal(core.sceneIdFromURL(core.markVideoURL('/stream?a=b', id)), id);
  assert.equal(core.sceneIdFromURL('/image/1'), null);
  assert.equal(core.sceneIdFromURL('/stream#gs-scene=%INVALID'), null);
  assert.equal(core.markVideoURL('', '1'), 'about:blank#gs-scene=1');
});

test('video slide paths stay unique and preserve each scene identity', () => {
  const entries = core.nativeEntries(core.toMedia([], [scene('1'), scene('2')], '10'));
  assert.notEqual(entries[0].paths.image, entries[1].paths.image);
  assert.notEqual(core.gridEntries(entries)[0].id, core.gridEntries(entries)[1].id);
});

const schemaDirectory = process.env.STASH_SCHEMA_DIR || path.resolve(__dirname, '../../stash/graphql/schema');
test('queries validate against the reference Stash GraphQL schema', {
  skip: !process.env.STASH_SCHEMA_DIR && !fs.existsSync(schemaDirectory) &&
    'Set STASH_SCHEMA_DIR to a Stash graphql/schema checkout',
}, () => {
  function files(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? files(filename) : filename.endsWith('.graphql') ? [filename] : [];
    });
  }
  const schema = buildSchema(files(schemaDirectory).map(filename => fs.readFileSync(filename, 'utf8')).join('\n'));
  for (const [name, document] of Object.entries(core.QUERIES)) {
    assert.deepEqual(validate(schema, parse(document)).map(error => error.message), [], name);
  }
});
