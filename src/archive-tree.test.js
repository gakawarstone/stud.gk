import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveTree } from './archive-tree.ts';
const listing = names => ({ entries: names.map(name => ({ name, size: 0, directory: name.endsWith('/') })), total: names.length, truncated: false });

test('archive tree removes a shared root and compacts implicit folder chains', () => {
  const tree = archiveTree(listing(['Demos/', 'Demos/README.md', 'Demos/src/main/kotlin/Main.kt', 'Demos/src/main/kotlin/User.kt']));
  assert.equal(tree.folder, 'Demos');
  assert.deepEqual(tree.rows.map(row => [row.name, row.depth]), [
    ['README.md', 0], ['src/main/kotlin', 0], ['Main.kt', 1], ['User.kt', 1],
  ]);
  assert.equal(tree.rows[2].path, 'Demos/src/main/kotlin/Main.kt');
});

test('archive tree preserves distinct roots, bounds visible rows, and handles empty archives', () => {
  const tree = archiveTree(listing(['a.txt', 'src/', 'src/b.kt', 'c.txt', 'd.txt', 'e.txt']));
  assert.equal(tree.folder, '');
  assert.equal(tree.rows.length, 5);
  assert.deepEqual(tree.rows.slice(0, 3).map(row => row.name), ['a.txt', 'src', 'b.kt']);
  assert.deepEqual(archiveTree(listing([])), { folder: '', rows: [] });
});
