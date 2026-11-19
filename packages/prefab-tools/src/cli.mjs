#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AssetCache, compressUuid, describeValue, loadAssetIndex, projectRoot, rel, saveAsset, serializeAsset, SerializedAsset, typeName } from './lib.mjs';
import { formatIssue, lintProject, pruneAsset } from './lint.mjs';
import { diffAssets } from './diff.mjs';
import { prefabTargets, resolveTarget, targetName } from './targets.mjs';

const HELP = `Usage: cocos-prefab <command> [args]

  lint [files…] [--warnings]   Validate references, script classes, hierarchy, fileIds and nested overrides.
                               Without files checks every .prefab/.scene under assets/. Exit 1 on errors.
  tree <file> [node] [--depth N] [--all]
                               Node hierarchy: #index, name, components, size, position, inactive, nested prefab.
  find <file> <query>          Nodes whose path ends with "query" (A/B) or whose name matches /regex/i.
  node <file> <node>           One node: transform, components with their serialized fields, nested overrides.
  refs <file> <node|#index>    Objects that reference the node (or object #index) and through which property.
  uuid <script.ts|uuid>        Asset UUID and the compressed __type__ Creator writes for a script component.
  diff <before> <after>        Compare nodes, components, properties and bindings. Supports REV:assets/path.
  prune <files…> [--dry-run] [--diff]
                               Plan removal of stale overrides and unreferenced objects; renumbers __id__.
                               --diff prints the exact patch on stdout.
                               Refuses unresolved dependencies or a result with lint errors. Inspect dry-run first.

Run from the Creator project root. <node> is a path suffix (Panel/Close), /regex/ or #index.
Paths of nested instances use their overridden names.`;

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter(arg => arg.startsWith('--')));
const option = name => { const at = rest.indexOf(name); return at >= 0 ? rest[at + 1] : undefined; };
const args = rest.filter((arg, i) => !arg.startsWith('--') && !(i > 0 && rest[i - 1] === '--depth'));

function fail(message) { console.error(message); process.exit(2); }

function loadDiffInput(input) {
  const revision = /^([^:]+):(assets\/.+)$/.exec(input);
  if (!revision) return SerializedAsset.load(resolve(input));
  const text = execFileSync('git', ['show', '--end-of-options', `${revision[1]}:./${revision[2]}`], {
    cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return new SerializedAsset(input, JSON.parse(text));
}

function printPatch(path, original, proposed) {
  const temp = mkdtempSync(join(tmpdir(), 'cocos-prune-'));
  const before = join(temp, 'before');
  const after = join(temp, 'after');
  try {
    writeFileSync(before, original);
    writeFileSync(after, proposed);
    const patch = spawnSync('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '--text', '--', before, after], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (patch.error) throw patch.error;
    const hunk = patch.stdout.indexOf('\n@@');
    if (patch.status !== 1 || hunk < 0) throw new Error(`Could not generate patch: ${patch.stderr}`);
    const filename = rel(path);
    process.stdout.write(`--- a/${filename}\n+++ b/${filename}${patch.stdout.slice(hunk)}`);
  } finally {
    rmSync(before, { force: true });
    rmSync(after, { force: true });
    rmdirSync(temp);
  }
}

function summarize(asset, index, node) {
  const object = asset.objects[node];
  const parts = [];
  for (const component of asset.components(node)) {
    const c = asset.objects[component];
    const name = typeName(index, c.__type__).replace(/^cc\./, '');
    if (c.__type__ === 'cc.UITransform') {
      const { width, height } = c._contentSize ?? {};
      parts.push(`${+width.toFixed(1)}×${+height.toFixed(1)}`);
    } else parts.push(c._enabled === false ? `${name}(off)` : name);
  }
  const { x = 0, y = 0 } = object._lpos ?? {};
  if (x || y) parts.push(`@${+x.toFixed(1)},${+y.toFixed(1)}`);
  const nested = asset.instance(node);
  if (nested) {
    const entry = index.assets.get(nested.asset);
    parts.push(`⟶ ${entry ? rel(entry.path).replace(/^assets\//, '') : nested.asset} (${nested.instance?.propertyOverrides?.length ?? 0} overrides)`);
  }
  if (object._active === false) parts.push('INACTIVE');
  return parts.join('  ');
}

function printTree(asset, index, start, maxDepth, all) {
  const seen = new Set();
  const visit = (node, depth, prefix) => {
    if (seen.has(node)) throw new Error(`Cycle or duplicate child at #${node}`);
    seen.add(node);
    console.log(`${prefix}#${node} ${asset.instanceName(node) ?? asset.name(node)}  ${summarize(asset, index, node)}`);
    if (depth >= maxDepth) {
      const count = asset.children(node).length;
      if (count) console.log(`${prefix}  … ${count} children`);
      return;
    }
    const children = asset.children(node);
    const shown = all || children.length <= 40 ? children : children.slice(0, 40);
    for (const child of shown) visit(child, depth + 1, `${prefix}  `);
    if (shown.length < children.length) console.log(`${prefix}  … ${children.length - shown.length} more (use --all)`);
  };
  visit(start, 0, '');
}

/** A referrer line; a TargetOverrideInfo is shown as the component field it binds (`DuelView.closeButton`). */
function describeReferrer(asset, index, { from, path }) {
  const object = asset.objects[from];
  if (object.__type__ === 'cc.TargetOverrideInfo') {
    const source = asset.objects[object.source?.__id__];
    const owner = asset.ownerNode(object.source?.__id__);
    const field = `${typeName(index, source?.__type__)}.${object.propertyPath?.join('.')}`;
    return `#${from} binding ${owner !== undefined ? asset.nodePath(owner) : '?'} ${field}${object.targetInfo ? ' (into the nested prefab)' : ''}`;
  }
  const owner = asset.ownerNode(from);
  return `#${from} ${owner !== undefined ? `${asset.nodePath(owner)} <${typeName(index, object.__type__)}>` : object.__type__} .${path}`;
}

const SKIP = new Set(['__type__', '_name', '_objFlags', '__editorExtras__', 'node', '__prefab', '_id']);

function printNode(asset, index, node) {
  const object = asset.objects[node];
  console.log(`#${node} ${asset.nodePath(node)}${object._active === false ? '  INACTIVE' : ''}`);
  const parent = object._parent?.__id__;
  if (parent !== undefined) console.log(`  parent: #${parent} ${asset.nodePath(parent)}`);
  for (const key of ['_lpos', '_euler', '_lscale', '_layer']) if (key in object) console.log(`  ${key}: ${describeValue(asset, index, object[key])}`);
  const children = asset.children(node);
  if (children.length) console.log(`  children: ${children.map(c => `#${c} ${asset.instanceName(c) ?? asset.name(c)}`).join(', ')}`);
  for (const component of asset.components(node)) {
    const c = asset.objects[component];
    console.log(`  [#${component}] ${typeName(index, c.__type__)}${c._enabled === false ? ' (disabled)' : ''}`);
    for (const [key, value] of Object.entries(c)) if (!SKIP.has(key)) console.log(`      ${key}: ${describeValue(asset, index, value)}`);
  }
  const nested = asset.instance(node);
  if (nested) {
    const entry = index.assets.get(nested.asset);
    console.log(`  nested prefab: ${entry ? rel(entry.path) : nested.asset}`);
    const targets = prefabTargets(new AssetCache(index), asset, nested);
    const describeTarget = targetInfo => targetName(resolveTarget(targets, asset.get(targetInfo)), index);
    for (const ref of nested.instance?.propertyOverrides ?? []) {
      const override = asset.objects[ref.__id__];
      console.log(`      [#${ref.__id__}] ${describeTarget(override.targetInfo)} .${override.propertyPath.join('.')} = ${describeValue(asset, index, override.value)}`);
    }
    for (const ref of nested.instance?.mountedChildren ?? []) {
      const mounted = asset.objects[ref.__id__];
      console.log(`      mounted under ${describeTarget(mounted.targetInfo)}: ${mounted.nodes.map(n => `#${n.__id__} ${asset.name(n.__id__)}`).join(', ')}`);
    }
  }
  const incoming = asset.referrers(node).filter(({ from }) => from !== parent && !asset.components(node).includes(from) && !children.includes(from));
  if (incoming.length) {
    console.log('  referenced by:');
    for (const referrer of incoming.slice(0, 30)) console.log(`      ${describeReferrer(asset, index, referrer)}`);
  }
}

if (!command || command === 'help' || command === '--help') { console.log(HELP); process.exit(0); }

const allowedFlags = { lint: ['--warnings'], tree: ['--depth', '--all'], find: [], node: [], refs: [], uuid: [], diff: [], prune: ['--dry-run', '--diff'] };
if (!allowedFlags[command]) fail(`Unknown command ${command}\n\n${HELP}`);
for (const flag of flags) if (!allowedFlags[command].includes(flag)) fail(`Unknown option for ${command}: ${flag}`);
if (flags.has('--depth') && (!/^\d+$/.test(option('--depth') ?? ''))) fail('--depth needs a non-negative integer');

try {
if (command !== 'uuid' && !statSync(join(projectRoot, 'assets'), { throwIfNoEntry: false })?.isDirectory()) {
  fail(`No assets directory in ${projectRoot}. Run cocos-prefab from the Creator project root.`);
}
if (command === 'lint') {
  const files = args.length ? args.map(file => resolve(file)) : undefined;
  const { issues, files: checked, index } = lintProject(files);
  const errors = issues.filter(issue => issue.level === 'error');
  const warnings = issues.filter(issue => issue.level === 'warning');
  for (const issue of flags.has('--warnings') ? issues : errors) console.log(formatIssue(issue));
  if (!index.internal) console.log('Creator install not found: built-in asset references were not verified (set COCOS_CREATOR_PATH).');
  const hidden = flags.has('--warnings') || !warnings.length ? '' : ` (show with --warnings)`;
  console.log(`Prefab lint: ${checked.length} files, ${errors.length} errors, ${warnings.length} warnings${hidden}.`);
  process.exitCode = errors.length ? 1 : 0;
} else if (command === 'prune') {
  if (!args.length) fail('prune needs files');
  const index = loadAssetIndex();
  if (index.duplicates.length) fail(lintProject([], index).issues.map(formatIssue).join('\n'));
  const log = flags.has('--diff') ? console.error : console.log;
  let changed = 0;
  for (const file of args) {
    const path = resolve(file);
    const snapshot = lstatSync(path);
    const original = readFileSync(path, 'utf8');
    const asset = new SerializedAsset(path, JSON.parse(original));
    const { staleOverrides, removed } = pruneAsset(asset, index);
    if (!staleOverrides.length && !removed.length) { log(`${rel(path)}: nothing to prune`); continue; }
    log(`${rel(path)}: ${staleOverrides.length} stale overrides (${staleOverrides.join(', ')}), ${removed.length} objects removed`);
    const proposed = serializeAsset(asset, original);
    if (flags.has('--diff')) printPatch(path, original, proposed);
    if (!flags.has('--dry-run')) {
      saveAsset(path, original, snapshot, proposed);
      const { issues } = lintProject([path], index);
      if (issues.some(issue => issue.level === 'error')) fail(`Saved asset failed validation: ${issues.map(formatIssue).join('\n')}`);
      changed++;
    }
  }
  if (changed) log('Saved assets passed lint; reopen changed prefabs in Creator if they are open.');
} else if (command === 'diff') {
  if (args.length !== 2) fail('diff needs two files or REV:assets/path arguments');
  const [before, after] = args.map(loadDiffInput);
  const lines = diffAssets(before, after, loadAssetIndex());
  console.log(lines.length ? lines.join('\n') : 'No semantic changes.');
} else if (command === 'uuid') {
  const [target] = args;
  if (!target) fail('uuid needs a script path or a UUID');
  const uuid = /^[0-9a-f-]{36}$/i.test(target) ? target : JSON.parse(readFileSync(`${target.replace(/\.meta$/, '')}.meta`, 'utf8')).uuid;
  console.log(`uuid: ${uuid}\n__type__: ${compressUuid(uuid)}`);
} else {
  const [file, query] = args;
  if (!file) fail(HELP);
  const asset = SerializedAsset.load(resolve(file));
  const index = loadAssetIndex();
  if (command === 'tree') {
    const start = query ? asset.resolveNode(query) : asset.rootIndex;
    printTree(asset, index, start, Number(option('--depth') ?? Infinity), flags.has('--all'));
  } else if (command === 'find') {
    if (!query) fail('find needs a query');
    const found = asset.find(query);
    for (const node of found) console.log(`#${node} ${asset.nodePath(node)}  ${summarize(asset, index, node)}`);
    if (!found.length) { console.log('No nodes found.'); process.exit(1); }
  } else if (command === 'node') {
    if (!query) fail('node needs a node query');
    printNode(asset, index, asset.resolveNode(query));
  } else if (command === 'refs') {
    if (!query) fail('refs needs a node query or #index');
    const target = /^#\d+$/.test(query) ? Number(query.slice(1)) : asset.resolveNode(query);
    for (const referrer of asset.referrers(target)) console.log(describeReferrer(asset, index, referrer));
  } else fail(`Unknown command ${command}\n\n${HELP}`);
}
} catch (error) {
  fail(error.message);
}
