import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compressUuid } from '../src/lib.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const ref = __id__ => ({ __id__ });
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

function project(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'cocos-prefab-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  function write(file, text) {
    const path = join(cwd, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  function run(...args) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, COCOS_CREATOR_PATH: join(cwd, 'Creator/CocosCreator.exe') },
    });
    if (result.error) throw result.error;
    return result;
  }
  return {
    cwd, write, run,
    prefab(file, id, objects) {
      write(file, JSON.stringify(objects, null, 2) + '\n');
      write(file + '.meta', JSON.stringify({ uuid: id }));
    },
    read: file => readFileSync(join(cwd, file), 'utf8'),
  };
}

test('indexes the caller project and checks component declarations in nested overrides', t => {
  const { prefab, run, write } = project(t);
  const outside = run('lint');
  assert.equal(outside.status, 2);
  assert.match(outside.stderr, /No assets directory/);
  assert.equal(run('help').status, 0);

  write('assets/View.ts', 'export class View { @property public highlighted = false; }');
  write('assets/View.ts.meta', JSON.stringify({ uuid: uuid(1), importer: 'typescript' }));
  const builtin = uuid(4);
  write('Creator/resources/resources/3d/engine/editor/assets/Frame.png.meta', JSON.stringify({ uuid: builtin }));
  prefab('assets/engines/Source.prefab', uuid(2), [
    { __type__: 'cc.Prefab', data: ref(1) },
    { __type__: 'cc.Node', _name: 'Source', _components: [ref(2)] },
    { __type__: compressUuid(uuid(1)), node: ref(1), __prefab: ref(3), frame: { __uuid__: builtin } },
    { __type__: 'cc.CompPrefabInfo', fileId: 'view' },
  ]);
  const instance = 'assets/Container.prefab';
  prefab(instance, uuid(3), [
    { __type__: 'cc.Prefab', data: ref(1) },
    { __type__: 'cc.Node', _name: 'Container', _children: [ref(3)], _prefab: ref(2) },
    { __type__: 'cc.PrefabInfo', nestedPrefabInstanceRoots: [ref(3)] },
    { __type__: 'cc.Node', _name: 'Instance', _parent: ref(1), _prefab: ref(4) },
    { __type__: 'cc.PrefabInfo', asset: { __uuid__: uuid(2) }, instance: ref(5) },
    { __type__: 'cc.PrefabInstance', fileId: 'instance', propertyOverrides: [ref(6)] },
    { __type__: 'CCPropertyOverrideInfo', targetInfo: ref(7), propertyPath: ['highlighted'], value: true },
    { __type__: 'cc.TargetInfo', localID: ['view'] },
  ]);
  const lint = run('lint', '--warnings');
  assert.equal(lint.status, 0, lint.stderr);
  assert.match(lint.stdout, /2 files, 0 errors, 0 warnings/);
  assert.doesNotMatch(lint.stdout, /Creator install not found/);
  const node = run('node', instance, 'Instance');
  assert.equal(node.status, 0, node.stderr);
  assert.match(node.stdout, /Source <View> \.highlighted = true/);
});

test('diff compares bindings and ignores renumbered references', t => {
  const { prefab, run } = project(t);
  const before = 'assets/Before.prefab';
  const after = 'assets/After.prefab';
  prefab(before, uuid(1), [
    { __type__: 'cc.Prefab', data: ref(1) },
    { __type__: 'cc.Node', _name: 'Root', _id: 'root', _children: [ref(2)], target: ref(2) },
    { __type__: 'cc.Node', _name: 'Child', _id: 'child', _parent: ref(1) },
  ]);
  const reordered = [
    { __type__: 'cc.Prefab', data: ref(2) },
    { __type__: 'cc.Node', _name: 'Child', _id: 'child', _parent: ref(2) },
    { __type__: 'cc.Node', _name: 'Root', _id: 'root', _children: [ref(1)], target: ref(1) },
  ];
  prefab(after, uuid(2), reordered);
  assert.match(run('diff', before, after).stdout, /No semantic changes/);
  reordered[2].target = ref(2);
  prefab(after, uuid(2), reordered);
  const diff = run('diff', before, after);
  assert.equal(diff.status, 0, diff.stderr);
  assert.match(diff.stdout, /Root \.target: "→ Root\/Child" → "→ Root"/);
});

test('prune previews a patch, preserves the file on dry run and validates the applied result', t => {
  const { cwd, prefab, run, read } = project(t);
  const file = 'assets/Test Asset.prefab';
  prefab(file, uuid(1), [
    { __type__: 'cc.Prefab', data: ref(2) },
    { __type__: 'cc.Node', _name: 'Orphan' },
    { __type__: 'cc.Node', _name: 'Root' },
  ]);
  const original = read(file);
  const plan = run('prune', file, '--dry-run', '--diff');
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(read(file), original);
  const patch = spawnSync('git', ['apply', '--check'], { cwd, input: plan.stdout, encoding: 'utf8' });
  if (patch.error) throw patch.error;
  assert.equal(patch.status, 0, patch.stderr);
  assert.equal(run('prune', file).status, 0);
  assert.deepEqual(JSON.parse(read(file)), [
    { __type__: 'cc.Prefab', data: ref(1) },
    { __type__: 'cc.Node', _name: 'Root' },
  ]);
  assert.equal(run('lint').status, 0);
});
