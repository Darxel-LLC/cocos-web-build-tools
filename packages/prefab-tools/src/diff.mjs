import { isDeepStrictEqual } from 'node:util';
import { AssetCache, isRef, rel, typeName } from './lib.mjs';
import { prefabTargets, resolveTarget, targetName } from './targets.mjs';

function snapshot(asset, index, cache) {
  const { objects } = asset;
  if (!Array.isArray(objects) || !asset.isNode(asset.rootIndex)) throw new Error(`Invalid serialized asset: ${asset.path}`);
  const owners = new Map();
  const mounts = new Map();
  for (const node of asset.nodeIndices()) {
    for (const component of asset.components(node)) owners.set(component, node);
    const nested = asset.instance(node);
    for (const ref of nested?.instance?.mountedChildren ?? []) {
      for (const child of asset.get(ref)?.nodes ?? []) mounts.set(child.__id__, node);
    }
    for (const ref of nested?.instance?.mountedComponents ?? []) {
      for (const component of asset.get(ref)?.components ?? []) owners.set(component.__id__, node);
    }
  }

  const ids = new Map([[0, 'asset']]);
  const scopes = new Map();
  const counts = new Map();
  const visiting = new Set();
  function identifyNode(at) {
    if (ids.has(at)) return ids.get(at);
    if (visiting.has(at)) throw new Error(`Cycle in the hierarchy of ${asset.path}`);
    visiting.add(at);
    const node = objects[at];
    const instance = asset.instance(at);
    const parent = mounts.get(at) ?? node._parent?.__id__;
    const owner = asset.get(node._prefab)?.root?.__id__;
    let scope = 'asset';
    if (asset.isNode(parent)) {
      identifyNode(parent);
      scope = scopes.get(parent);
    } else if (owner !== at && asset.isNode(owner) && asset.instance(owner)) {
      scope = identifyNode(owner);
    }
    const named = instance?.instance?.fileId || asset.get(node._prefab)?.fileId || node._id;
    const name = asset.instanceName(at) ?? asset.name(at);
    // shortcut: nodes without an ID use name and sibling order, so a rename appears as removal and addition.
    const identity = named ? `node:${named}` : `name:${JSON.stringify(name)}`;
    const container = named || !asset.isNode(parent) ? scope : identifyNode(parent);
    const id = unique(`${container}/${identity}`);
    ids.set(at, id);
    scopes.set(at, instance ? id : scope);
    visiting.delete(at);
    return id;
  }
  function unique(base) {
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n === 1 ? base : `${base}[${n}]`;
  }
  // Walk explicit hierarchy order before assigning fallback identities to same-name nodes.
  const visited = new Set();
  function follow(node) {
    if (visited.has(node)) return;
    visited.add(node);
    identifyNode(node);
    for (const child of asset.children(node)) {
      if (asset.isNode(child)) follow(child);
    }
  }
  follow(asset.rootIndex);
  for (const node of asset.nodeIndices()) follow(node);
  for (const [at, node] of owners) {
    if (!objects[at]?.__type__ || ids.has(at)) continue;
    const component = objects[at];
    const id = asset.get(component.__prefab)?.fileId || component._id || component.__type__;
    ids.set(at, unique(`${ids.get(node)}/component:${id}`));
  }

  function value(input, stack = []) {
    if (input == null || typeof input !== 'object') return input;
    if (Array.isArray(input)) return input.map(item => value(item, stack));
    if (isRef(input)) {
      const at = input.__id__;
      if (ids.has(at)) return { ref: ids.get(at) };
      if (!objects[at]) return { missing: at };
      const ancestor = stack.indexOf(at);
      return ancestor >= 0 ? { cycle: ancestor } : value(objects[at], [...stack, at]);
    }
    return Object.fromEntries(Object.keys(input).sort().map(key => [key, value(input[key], stack)]));
  }

  const rows = new Map();
  const maps = new Map();
  function describeTarget(at, info) {
    const instance = asset.instance(at);
    if (!instance || !info) return null;
    if (!maps.has(at)) maps.set(at, prefabTargets(cache, asset, instance));
    const target = resolveTarget(maps.get(at), info);
    return target.error ? null : targetName(target, index);
  }
  function labelFor(at) {
    const type = typeName(index, objects[at]?.__type__);
    if (asset.isNode(at)) return asset.nodePath(at);
    return owners.has(at) ? `${asset.nodePath(owners.get(at))} <${type}>` : type;
  }
  for (const [at, id] of ids) {
    const object = objects[at];
    const fields = new Map();
    const labels = new Map();
    for (const key of Object.keys(object).sort()) {
      if (!['__type__', '_id', '__editorExtras__', '_prefab', '__prefab', 'node'].includes(key)) fields.set(key, value(object[key]));
    }
    if (asset.isNode(at)) {
      const info = asset.get(object._prefab);
      const nested = asset.instance(at);
      if (nested) {
        fields.set('prefab', nested.asset);
        for (const key of ['mountedChildren', 'mountedComponents', 'removedComponents']) {
          if (nested.instance?.[key]?.length) fields.set(key, value(nested.instance[key]));
        }
      }
      function recordOverrides(refs, describe) {
        const order = [];
        for (const ref of refs ?? []) {
          const record = asset.get(ref);
          if (!record) continue;
          const [name, item, display] = describe(record);
          let field = name;
          for (let n = 2; fields.has(field); n++) field = `${name} [${n}]`;
          fields.set(field, item);
          if (display) labels.set(field, display + field.slice(name.length));
          order.push(field);
        }
        return order;
      }
      const order = recordOverrides(nested?.instance?.propertyOverrides, record => {
        const target = asset.get(record.targetInfo);
        const address = target?.localID?.join('/') ?? '?';
        const property = record.propertyPath?.join('.');
        return [`override ${address}.${property}`, value(record.value), `override ${describeTarget(at, target) ?? address}.${property}`];
      });
      if (order.length) fields.set('override order', order);
      const bindings = recordOverrides(info?.targetOverrides, record => {
        const source = record.source?.__id__;
        const sourceInfo = asset.get(record.sourceInfo);
        const property = record.propertyPath?.join('.');
        return [
          `binding ${JSON.stringify([value(record.source), sourceInfo?.localID, record.propertyPath])}`,
          { node: value(record.target), localID: asset.get(record.targetInfo)?.localID },
          `binding ${describeTarget(source, sourceInfo) ?? labelFor(source) ?? '?'}.${property}`,
        ];
      });
      if (bindings.length) fields.set('binding order', bindings);
    }
    rows.set(id, { label: labelFor(at), type: object.__type__, fields, labels });
  }
  return rows;
}

export function diffAssets(before, after, index) {
  const cache = new AssetCache(index);
  const left = snapshot(before, index, cache);
  const right = snapshot(after, index, cache);
  const lines = [];
  const describe = (item, rows) => JSON.stringify(item, (_, value) => {
    if (rows.has(value?.ref)) return `→ ${rows.get(value.ref).label}`;
    const asset = index.assets.get(value?.__uuid__);
    return asset?.origin === 'project' ? rel(asset.path) : value;
  }) ?? '(absent)';
  function emit(label, field, a, b) {
    if (isDeepStrictEqual(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      a.forEach((item, i) => emit(label, `${field}[${i}]`, item, b[i]));
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)
      && a.__type__ === b.__type__ && !['ref', 'missing', 'cycle', '__uuid__'].some(key => key in a || key in b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) emit(label, `${field}.${key}`, a[key], b[key]);
      return;
    }
    lines.push(`~ ${label} .${field}: ${describe(a, left)} → ${describe(b, right)}`);
  }
  for (const [id, row] of left) if (!right.has(id)) lines.push(`- ${row.label}`);
  for (const [id, next] of right) {
    const prev = left.get(id);
    if (!prev) { lines.push(`+ ${next.label}`); continue; }
    const label = next.label;
    if (prev.type !== next.type) lines.push(`~ ${label} type: ${prev.type} → ${next.type}`);
    for (const field of new Set([...prev.fields.keys(), ...next.fields.keys()])) {
      let a = prev.fields.get(field);
      let b = next.fields.get(field);
      if ((field === 'override order' || field === 'binding order') && Array.isArray(a) && Array.isArray(b)) {
        const keys = new Set(a.filter(key => b.includes(key)));
        a = a.filter(key => keys.has(key));
        b = b.filter(key => keys.has(key));
      }
      emit(label, next.labels.get(field) ?? prev.labels.get(field) ?? field, a, b);
    }
  }
  return lines;
}
