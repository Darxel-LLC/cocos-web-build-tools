// Structural checks for serialized prefabs and scenes. Errors mean the editor would lose or misread data.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { AssetCache, forEachRef, isRef, loadAssetIndex, projectRoot, rel, removeObjects, SerializedAsset, typeName, walkFiles } from './lib.mjs';
import { prefabTargets, resolveTarget, targetName } from './targets.mjs';

const SCRIPT_CLASS = /^[0-9a-f]{5}[A-Za-z0-9+/]{18}$/;
const require = createRequire(import.meta.url);
const declarations = new WeakMap();

export function serializedAssetFiles(root = projectRoot) {
  return walkFiles(join(root, 'assets'), path => /\.(prefab|scene)$/.test(path));
}

function scriptMembers(index, type) {
  const path = index.scripts.get(type);
  if (!path) return null;
  if (!declarations.has(index)) declarations.set(index, new Map());
  const members = declarations.get(index);
  if (!members.has(path)) {
    let names = null;
    try {
      const ts = require('typescript');
      const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
      const classes = file.statements.filter(ts.isClassDeclaration);
      const component = classes.find(cls => cls.name?.text === typeName(index, type)) ?? (classes.length === 1 ? classes[0] : null);
      if (component && !file.parseDiagnostics.length) {
        // shortcut: local class members only, use the editor to confirm inherited or computed properties.
        names = new Set(component.members.filter(member =>
          (ts.isPropertyDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member))
          && !member.modifiers?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword))
          .map(member => member.name?.text).filter(Boolean));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    members.set(path, names);
  }
  return members.get(path);
}

export function lintAsset(asset, index, cache = new AssetCache(index)) {
  const issues = [];
  const { objects } = asset;
  const report = (level, at, message) => issues.push({ level, at, path: at >= 0 && objects[at] ? where(asset, at) : '', message });

  if (!Array.isArray(objects) || !objects.length) return [{ level: 'error', at: -1, path: '', message: 'not a serialized asset array' }];
  const head = objects[0]?.__type__;
  if (head !== 'cc.Prefab' && head !== 'cc.SceneAsset') report('error', 0, `first object is ${head}, expected cc.Prefab or cc.SceneAsset`);
  if (asset.rootIndex === undefined || !asset.isNode(asset.rootIndex)) report('error', 0, 'root reference does not point to a node');
  if (!existsSync(`${asset.path}.meta`)) report('error', -1, 'missing .meta file next to the asset');

  // References and types.
  objects.forEach((object, i) => {
    if (object === null || typeof object !== 'object' || typeof object.__type__ !== 'string') {
      report('error', i, 'element without __type__');
      return;
    }
    const type = object.__type__;
    if (SCRIPT_CLASS.test(type) && !index.scripts.has(type)) {
      report('error', i, `unknown script class ${type}: the script was deleted or its .meta UUID changed`);
    }
    forEachRef(object, (ref, path) => {
      if (isRef(ref)) {
        if (!Number.isInteger(ref.__id__) || ref.__id__ < 0 || ref.__id__ >= objects.length || !objects[ref.__id__]) report('error', i, `${path.join('.')} → #${ref.__id__} is outside the array (${objects.length})`);
      } else if (typeof ref.__uuid__ !== 'string' || !ref.__uuid__) {
        report('error', i, `${path.join('.')} has an invalid asset UUID`);
      } else if (!index.assets.has(ref.__uuid__)) {
        const internalMissing = !index.internal;
        report(internalMissing ? 'warning' : 'error', i, `${path.join('.')} → asset ${ref.__uuid__} not found${internalMissing ? ' (Creator install not found; set COCOS_CREATOR_PATH to verify built-in assets)' : ''}`);
      }
    });
  });
  if (issues.some(issue => issue.level === 'error' && /outside the array|without __type__/.test(issue.message))) return issues;

  objects.forEach((object, i) => {
    const fields = asset.isNode(i) ? ['_children', '_components'] : [];
    if (object.__type__ === 'cc.PrefabInstance') fields.push('propertyOverrides', 'removedComponents', 'mountedChildren', 'mountedComponents');
    if (object.__type__ === 'cc.MountedChildrenInfo') fields.push('nodes');
    if (object.__type__ === 'cc.MountedComponentsInfo') fields.push('components');
    for (const field of fields) {
      if (object[field] !== undefined && (!Array.isArray(object[field]) || object[field].some(ref => !isRef(ref)))) report('error', i, `${field} must be an array of object references`);
    }
  });
  if (issues.some(issue => /must be an array/.test(issue.message))) return issues;

  // Hierarchy: parents, children and component owners agree. Nodes mounted into a nested instance are
  // listed by cc.MountedChildrenInfo instead of their parent's _children.
  const mounted = new Set();
  for (const object of objects) {
    if (object.__type__ === 'cc.MountedChildrenInfo') for (const ref of object.nodes ?? []) mounted.add(ref.__id__);
  }
  for (const node of asset.nodeIndices()) {
    const ancestors = new Set([node]);
    let ancestor = objects[node]._parent?.__id__;
    while (ancestor !== undefined) {
      if (ancestors.has(ancestor)) { report('error', node, 'cycle in node hierarchy'); break; }
      ancestors.add(ancestor);
      ancestor = objects[ancestor]?._parent?.__id__;
    }
    if (new Set(asset.children(node)).size !== asset.children(node).length) report('error', node, 'duplicate child in _children');
    if (new Set(asset.components(node)).size !== asset.components(node).length) report('error', node, 'duplicate component in _components');
    for (const child of asset.children(node)) {
      if (!asset.isNode(child)) report('error', node, `_children has #${child}, which is ${objects[child]?.__type__}`);
      else if (objects[child]._parent?.__id__ !== node) report('error', child, `_parent is #${objects[child]._parent?.__id__}, but #${node} lists it as a child`);
    }
    const parent = objects[node]._parent?.__id__;
    if (parent !== undefined && !asset.children(parent).includes(node) && !mounted.has(node)) {
      report('error', node, `_parent #${parent} lists it neither in _children nor as a mounted child`);
    }
    for (const component of asset.components(node)) {
      if (objects[component]?.node?.__id__ !== node) report('error', component, `component ${typeName(index, objects[component]?.__type__)} belongs to #${objects[component]?.node?.__id__}, but #${node} lists it`);
    }
  }

  // Everything must be reachable from the header; orphans are leftovers of hand edits.
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    forEachRef(objects[queue.pop()], ref => {
      if (isRef(ref) && !seen.has(ref.__id__)) { seen.add(ref.__id__); queue.push(ref.__id__); }
    });
  }
  objects.forEach((object, i) => { if (!seen.has(i)) report('error', i, `orphan ${object.__type__}: nothing references it`); });

  // fileIds of this asset's own nodes, components and instances must be unique.
  const fileIds = new Map();
  objects.forEach((object, i) => {
    const own = (object.__type__ === 'cc.PrefabInfo' && !object.instance) || object.__type__ === 'cc.CompPrefabInfo' || object.__type__ === 'cc.PrefabInstance';
    if (!own || !object.fileId) return;
    if (fileIds.has(object.fileId)) report('error', i, `fileId ${object.fileId} duplicates #${fileIds.get(object.fileId)}`);
    else fileIds.set(object.fileId, i);
  });

  // Nested prefab instances: overrides must address objects that exist in the nested prefab.
  const maps = new Map();
  const checkTarget = (node, at, targetInfo, label, expected) => {
    const instance = asset.instance(node);
    if (!instance) {
      report('error', at, `${label}: #${node ?? '?'} is not a prefab instance`);
      return null;
    }
    if (!maps.has(node)) maps.set(node, prefabTargets(cache, asset, instance));
    const result = resolveTarget(maps.get(node), targetInfo, expected);
    if (result.error) report('error', at, `${asset.nodePath(node)} ${label}: ${result.error}`);
    return result;
  };
  for (const node of asset.nodeIndices()) {
    const nested = asset.instance(node);
    if (!nested) continue;
    const instanceIndex = nested.info.instance.__id__;
    const instance = nested.instance;
    if (!nested.asset || instance?.__type__ !== 'cc.PrefabInstance') {
      report('error', instanceIndex, 'nested node requires a prefab asset and cc.PrefabInstance');
      continue;
    }
    for (const ref of instance.propertyOverrides ?? []) {
      const override = asset.get(ref);
      const path = override?.propertyPath;
      if (!Array.isArray(path) || !path.length || !path.every(key => typeof key === 'string' && key)) {
        report('error', ref.__id__, `${asset.nodePath(node)} override has an invalid propertyPath`);
        continue;
      }
      const result = checkTarget(node, ref.__id__, asset.get(override.targetInfo), `override ${path.join('.')}`);
      const target = result?.asset?.objects[result.index];
      if (target && !Object.hasOwn(target, path[0]) && !scriptMembers(index, target.__type__)?.has(path[0])) {
        report('warning', ref.__id__, `${asset.nodePath(node)} override ${targetName(result, index)}.${path.join('.')}: "${path[0]}" is absent from the base serialization and was not confirmed on the component`);
      }
    }
    for (const ref of instance.removedComponents ?? []) checkTarget(node, ref.__id__, asset.get(ref), 'removed component', 'component');
    for (const ref of instance.mountedChildren ?? []) checkTarget(node, ref.__id__, asset.get(asset.get(ref)?.targetInfo), 'mounted child parent', 'node');
    for (const ref of instance.mountedComponents ?? []) checkTarget(node, ref.__id__, asset.get(asset.get(ref)?.targetInfo), 'mounted component owner', 'node');
  }
  objects.forEach((object, i) => {
    if (object.__type__ !== 'cc.TargetOverrideInfo') return;
    const path = object.propertyPath;
    if (!Array.isArray(path) || !path.length || !path.every(key => typeof key === 'string' && key)) {
      report('error', i, 'target override has an invalid propertyPath');
      return;
    }
    const label = `binding ${path.join('.')}`;
    if (object.targetInfo) checkTarget(object.target?.__id__, i, asset.get(object.targetInfo), label);
    else if (!object.target) report('error', i, `${label} has no target`);
    if (object.sourceInfo) checkTarget(object.source?.__id__, i, asset.get(object.sourceInfo), `${label} source`);
    else if (!object.source) report('error', i, `${label} has no source`);
  });

  // The root PrefabInfo lists every nested instance root so the editor can sync them.
  if (asset.kind === 'prefab' && asset.rootIndex !== undefined) {
    const rootInfo = asset.get(objects[asset.rootIndex]?._prefab);
    const listed = new Set((rootInfo?.nestedPrefabInstanceRoots ?? []).map(ref => ref.__id__));
    for (const node of asset.nodeIndices()) {
      if (node !== asset.rootIndex && asset.instance(node) && !listed.has(node)) report('error', node, 'nested instance root is missing from nestedPrefabInstanceRoots');
    }
    for (const node of listed) if (!asset.instance(node)) report('error', node, 'nestedPrefabInstanceRoots lists a node that is not an instance root');
  }
  return issues;
}

/**
 * Drops dead data that changes nothing at runtime: overrides whose target no longer exists in the nested
 * prefab, and objects nothing references. Returns what was removed; the caller saves the asset.
 */
export function pruneAsset(asset, index, cache = new AssetCache(index)) {
  // Plan on a copy. A missing/unreadable dependency is not proof that an override is dead.
  const draft = new SerializedAsset(asset.path, structuredClone(asset.objects));
  const { objects } = draft;
  if (!Array.isArray(objects) || !objects.length) throw new Error('not a serialized asset array');
  const staleOverrides = [];
  for (const node of draft.nodeIndices()) {
    const nested = draft.instance(node);
    if (!nested) continue;
    const scope = prefabTargets(cache, draft, nested);
    const problem = scope.problem ?? scope.dependencyProblem;
    if (problem) throw new Error(`Cannot prune ${draft.nodePath(node)}: ${problem}`);
    const instance = nested.instance;
    if (!instance?.propertyOverrides) continue;
    instance.propertyOverrides = instance.propertyOverrides.filter(ref => {
      const targetInfo = draft.get(draft.get(ref)?.targetInfo);
      const result = resolveTarget(scope, targetInfo);
      if (result.unavailable) throw new Error(`Cannot prune ${draft.nodePath(node)}: ${result.error}`);
      if (result.missing) staleOverrides.push(`#${ref.__id__} ${draft.get(ref).propertyPath?.join('.')}`);
      return !result.missing;
    });
  }
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    forEachRef(objects[queue.pop()], ref => {
      if (isRef(ref) && !seen.has(ref.__id__)) { seen.add(ref.__id__); queue.push(ref.__id__); }
    });
  }
  const orphans = new Set(objects.flatMap((_, i) => (seen.has(i) ? [] : [i])));
  const removed = [...orphans].map(i => `#${i} ${objects[i].__type__}`);
  if (orphans.size) draft.objects = removeObjects(objects, orphans);
  const errors = lintAsset(draft, index, cache).filter(issue => issue.level === 'error');
  if (errors.length) throw new Error(`Cannot prune an invalid asset: ${errors.map(issue => issue.message).join('; ')}`);
  asset.objects = draft.objects;
  return { staleOverrides, removed };
}

function where(asset, at) {
  const owner = asset.ownerNode(at);
  if (owner !== undefined) return asset.nodePath(owner);
  const holder = asset.referrers(at)[0];
  const ownerOfHolder = holder ? asset.ownerNode(holder.from) : undefined;
  return ownerOfHolder !== undefined ? `${asset.nodePath(ownerOfHolder)} (${asset.objects[at].__type__})` : asset.objects[at].__type__;
}

/** Lints files (default: every prefab and scene). Returns {issues, index}; duplicate meta UUIDs are project errors. */
export function lintProject(files = serializedAssetFiles(), index = loadAssetIndex()) {
  const cache = new AssetCache(index);
  const issues = index.duplicates.map(({ uuid, paths, error }) => ({
    file: rel(paths[0]), level: 'error', at: -1, path: '',
    message: error ?? `UUID ${uuid} is used by ${paths.map(rel).join(' and ')} (copied .meta?)`,
  }));
  for (const file of files) {
    let asset;
    try { asset = SerializedAsset.load(file); } catch (error) {
      issues.push({ file: rel(file), level: 'error', at: -1, path: '', message: `invalid JSON: ${error.message}` });
      continue;
    }
    for (const issue of lintAsset(asset, index, cache)) issues.push({ file: rel(file), ...issue });
  }
  return { issues, index, files };
}

export function formatIssue(issue) {
  const at = issue.at >= 0 ? ` #${issue.at}` : '';
  const path = issue.path ? ` ${issue.path}` : '';
  return `${issue.level === 'error' ? 'ERROR' : 'warn '} ${issue.file}${at}${path}: ${issue.message}`;
}
