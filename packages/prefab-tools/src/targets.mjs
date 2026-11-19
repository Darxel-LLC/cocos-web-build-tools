import { rel, typeName } from './lib.mjs';

/** Builds the fileId namespaces used by Cocos 3.8.8's prefab target map. */
export function prefabTargets(cache, owner, nested, ancestors = new Set()) {
  const scope = { entries: new Map(), label: nested.asset ?? '(missing UUID)' };
  let source;
  try { source = cache.byUuid(nested.asset); } catch (error) {
    scope.problem = `cannot read prefab ${scope.label}: ${error.message}`;
    return scope;
  }
  if (!Array.isArray(source?.objects) || source.objects[0]?.__type__ !== 'cc.Prefab' || !source.isNode(source.rootIndex)) {
    scope.problem = `prefab ${scope.label} is unavailable or invalid`;
    return scope;
  }
  scope.label = rel(source.path);
  if (ancestors.has(source.path)) {
    scope.problem = `cyclic prefab dependency in ${scope.label}`;
    return scope;
  }
  const chain = new Set([...ancestors, source.path]);
  const visited = new Map();

  function add(scope, fileId, entry) {
    if (!fileId) return;
    const previous = scope.entries.get(fileId);
    if (previous?.asset === entry.asset && previous?.index === entry.index && !previous?.scope) return;
    scope.entries.set(fileId, previous ? { problem: `ambiguous fileId ${fileId}` } : entry);
  }

  function addComponent(asset, index, scope, node) {
    const component = asset.objects[index];
    if (!component?.__type__ || asset.isNode(index)) {
      scope.problem = `invalid component #${index} in ${rel(asset.path)}`;
      return;
    }
    const info = asset.get(component.__prefab);
    if (component.__prefab && info?.__type__ !== 'cc.CompPrefabInfo') {
      scope.problem = `invalid component prefab info at #${index} in ${rel(asset.path)}`;
      return;
    }
    add(scope, info?.fileId, { asset, index, node });
  }

  function addNode(asset, index, scope) {
    if (!visited.has(asset)) visited.set(asset, new Set());
    const seen = visited.get(asset);
    if (!asset.isNode(index) || seen.has(index)) {
      scope.problem = `invalid or repeated node #${index} in ${rel(asset.path)}`;
      return;
    }
    seen.add(index);
    const instance = asset.instance(index);
    if (index !== source.rootIndex || asset !== source) {
      if (instance) {
        const fileId = instance.instance?.fileId;
        if (!fileId || instance.instance.__type__ !== 'cc.PrefabInstance') scope.problem = `invalid prefab instance at #${index} in ${rel(asset.path)}`;
        else {
          const child = prefabTargets(cache, asset, instance, chain);
          scope.dependencyProblem ??= child.problem ?? child.dependencyProblem;
          add(scope, fileId, { asset, index, scope: child });
        }
        return;
      }
    }
    const node = asset.objects[index];
    if ((node._children != null && !Array.isArray(node._children)) || (node._components != null && !Array.isArray(node._components))) {
      scope.problem = `invalid node #${index} in ${rel(asset.path)}`;
      return;
    }
    const info = asset.get(node._prefab);
    if (node._prefab && info?.__type__ !== 'cc.PrefabInfo') {
      scope.problem = `invalid node prefab info at #${index} in ${rel(asset.path)}`;
      return;
    }
    add(scope, info?.fileId, { asset, index, node: index });
    for (const component of asset.components(index)) addComponent(asset, component, scope, index);
    for (const child of asset.children(index)) addNode(asset, child, scope);
  }

  function targetsAfterExpansion(field, expected, apply) {
    const refs = nested.instance?.[field] ?? [];
    if (!Array.isArray(refs)) { scope.problem = `invalid ${field} in ${rel(owner.path)}`; return; }
    for (const ref of refs) {
      const record = owner.get(ref);
      const target = resolveTarget(scope, field === 'removedComponents' ? record : owner.get(record?.targetInfo), expected);
      if (target.error || apply(record, target) === false) scope.problem = `cannot apply ${field} in ${rel(owner.path)}`;
    }
  }

  addNode(source, source.rootIndex, scope);
  targetsAfterExpansion('mountedChildren', 'node', (record, target) => {
    if (!Array.isArray(record.nodes)) return false;
    for (const ref of record.nodes) addNode(owner, ref?.__id__, target.scope);
  });
  if (ancestors.size) {
    // An enclosing instance rebuilds its map from the already-expanded child.
    targetsAfterExpansion('removedComponents', 'component', (_, target) => target.scope.entries.delete(target.fileId));
    targetsAfterExpansion('mountedComponents', 'node', (record, target) => {
      if (!Array.isArray(record.components)) return false;
      for (const ref of record.components) addComponent(owner, ref?.__id__, target.scope, target.index);
    });
  }
  return scope;
}

export function resolveTarget(scope, targetInfo, expected) {
  const ids = targetInfo?.localID;
  if (targetInfo?.__type__ !== 'cc.TargetInfo' || !Array.isArray(ids) || !ids.length || !ids.every(id => typeof id === 'string' && id)) {
    return { error: 'invalid TargetInfo.localID' };
  }
  const instances = [];
  for (const [i, id] of ids.entries()) {
    const location = `localID[${i}] ${id} in ${scope.label}`;
    const entry = scope.entries.get(id);
    if (entry?.problem || (!entry && scope.problem)) return { error: `${location}: ${entry?.problem ?? scope.problem}`, unavailable: true };
    if (!entry) return { error: `${location}: fileId not found`, missing: true };
    if (i < ids.length - 1 && entry.scope) {
      instances.push(entry.asset.instanceName(entry.index) ?? entry.asset.name(entry.index));
      scope = entry.scope;
      continue;
    }
    if (i < ids.length - 1) return { error: `${location}: expected a nested instance` };
    const kind = entry.scope ? 'instance namespace' : entry.asset.isNode(entry.index) ? 'node' : 'component';
    if (entry.scope || (expected && expected !== kind)) return { error: `${location}: found ${kind}, expected ${expected ?? 'node or component'}` };
    return { ...entry, scope, fileId: id, instances };
  }
}

export function targetName(target, index) {
  if (target.error) return target.error;
  const { asset, index: at, node, instances } = target;
  const owner = [...instances, asset.nodePath(node)].join('/');
  return at === node ? owner : `${owner} <${typeName(index, asset.objects[at].__type__)}>`;
}
