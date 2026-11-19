// Helpers for Cocos Creator 3.8 serialized assets (.prefab, .scene, .meta).
// A serialized asset is a JSON array; {"__id__": n} points to element n, {"__uuid__": "..."} to an asset.
// Prefer editor tools (Funplay MCP) for structural edits; use this to inspect and to validate results.
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const projectRoot = process.cwd();
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Class id Creator writes in `__type__` for a user script: 5 hex chars, then base64 of the remaining 27. */
export function compressUuid(uuid) {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`Not a UUID: ${uuid}`);
  let out = hex.slice(0, 5);
  for (let i = 5; i < 32; i += 3) {
    const value = parseInt(hex.slice(i, i + 3), 16);
    out += B64[value >> 6] + B64[value & 63];
  }
  return out;
}

export function decompressUuid(id) {
  if (!/^[0-9a-f]{5}[A-Za-z0-9+/]{18}$/i.test(id)) throw new Error(`Not a compressed class id: ${id}`);
  let hex = id.slice(0, 5);
  for (let i = 5; i < 23; i += 2) {
    const value = (B64.indexOf(id[i]) << 6) | B64.indexOf(id[i + 1]);
    hex += value.toString(16).padStart(3, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function walkFiles(dir, accept, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkFiles(path, accept, out);
    else if (accept(path)) out.push(path);
  }
  return out;
}

export const toPosix = path => path.split(sep).join('/');
export const rel = path => toPosix(relative(projectRoot, resolve(path)));

/** Built-in editor assets (default sprites, materials) live in the Creator install, not in the project. */
function creatorAssetsDir(root) {
  let exe = process.env.COCOS_CREATOR_PATH;
  if (!exe && process.platform === 'win32') {
    const manifest = join(root, 'package.json');
    const version = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).creator?.version : undefined;
    if (version) exe = join(process.env.ProgramData || 'C:/ProgramData', 'cocos/editors/Creator', version, 'CocosCreator.exe');
  }
  if (!exe) return null;
  const dir = join(dirname(resolve(root, exe)), 'resources/resources/3d/engine/editor/assets');
  return existsSync(dir) ? dir : null;
}

/**
 * Index of every asset UUID (with sub-assets such as `uuid@f9941`) and every script class id.
 * `internal` is false when the Creator install is missing; built-in references then cannot be verified.
 */
export function loadAssetIndex(root = projectRoot) {
  const assets = new Map();
  const scripts = new Map();
  const duplicates = [];
  const addMeta = (metaPath, origin) => {
    let meta;
    try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch (error) {
      duplicates.push({ uuid: null, paths: [metaPath], error: `unreadable meta: ${error.message}` });
      return;
    }
    if (!meta.uuid) return;
    const assetPath = metaPath.slice(0, -'.meta'.length);
    if (assets.has(meta.uuid) && origin === 'project') duplicates.push({ uuid: meta.uuid, paths: [assets.get(meta.uuid).path, assetPath] });
    assets.set(meta.uuid, { path: assetPath, importer: meta.importer, origin });
    const addSubs = (parent, subMetas) => {
      for (const [key, sub] of Object.entries(subMetas ?? {})) {
        const id = sub.uuid ?? `${parent}@${key}`;
        assets.set(id, { path: `${assetPath}@${sub.name ?? key}`, importer: sub.importer, origin });
        addSubs(id, sub.subMetas);
      }
    };
    addSubs(meta.uuid, meta.subMetas);
    if (meta.importer === 'typescript' || meta.importer === 'javascript') scripts.set(compressUuid(meta.uuid), assetPath);
  };
  for (const meta of walkFiles(join(root, 'assets'), path => path.endsWith('.meta'))) addMeta(meta, 'project');
  const internalDir = creatorAssetsDir(root);
  if (internalDir) for (const meta of walkFiles(internalDir, path => path.endsWith('.meta'))) addMeta(meta, 'internal');
  return { assets, scripts, duplicates, internal: Boolean(internalDir) };
}

export function isRef(value) { return value !== null && typeof value === 'object' && Object.hasOwn(value, '__id__'); }

/** Calls visit(value, path) for every {__id__}/{__uuid__} inside one serialized object. */
export function forEachRef(object, visit, path = []) {
  if (Array.isArray(object)) { object.forEach((item, i) => forEachRef(item, visit, [...path, i])); return; }
  if (object === null || typeof object !== 'object') return;
  if (isRef(object) || Object.hasOwn(object, '__uuid__')) { visit(object, path); return; }
  for (const [key, value] of Object.entries(object)) forEachRef(value, visit, [...path, key]);
}

export class SerializedAsset {
  constructor(path, objects = JSON.parse(readFileSync(path, 'utf8'))) {
    this.path = path;
    this.objects = objects;
    this.kind = objects?.[0]?.__type__ === 'cc.SceneAsset' ? 'scene' : 'prefab';
  }

  static load(path) { return new SerializedAsset(path); }

  get(ref) { return isRef(ref) ? this.objects[ref.__id__] : undefined; }

  get rootIndex() {
    const head = this.objects[0];
    return (this.kind === 'scene' ? head?.scene : head?.data)?.__id__;
  }

  isNode(index) { const type = this.objects[index]?.__type__; return type === 'cc.Node' || type === 'cc.Scene'; }

  nodeIndices() { return this.objects.flatMap((object, i) => (this.isNode(i) ? [i] : [])); }

  name(index) { return this.objects[index]?._name ?? `#${index}`; }

  /** Slash path from the root node, e.g. `Duel/Panel/Close`. */
  nodePath(index) {
    const names = [];
    for (let i = index, guard = 0; i !== undefined && guard < 1000; guard++) {
      names.unshift(this.instanceName(i) ?? this.name(i));
      i = this.objects[i]?._parent?.__id__;
    }
    return names.join('/');
  }

  /** Nested prefab instance root: the PrefabInstance that serializes its content. */
  instance(index) {
    const info = this.get(this.objects[index]?._prefab);
    return info?.instance ? { info, instance: this.get(info.instance), asset: info.asset?.__uuid__ } : null;
  }

  /** A nested instance root's real name lives in a `_name` override; the serialized `_name` may be stale. */
  instanceName(index) {
    const nested = this.instance(index);
    if (!nested) return undefined;
    const overrides = nested.instance?.propertyOverrides;
    if (!Array.isArray(overrides)) return undefined;
    for (const ref of overrides) {
      const override = this.get(ref);
      if (override?.propertyPath?.length === 1 && override.propertyPath[0] === '_name'
        && this.get(override.targetInfo)?.localID?.length === 1 && this.get(override.targetInfo).localID[0] === nested.info.fileId) {
        return override.value;
      }
    }
    return undefined;
  }

  components(index) { return (this.objects[index]?._components ?? []).map(ref => ref.__id__); }

  children(index) { return (this.objects[index]?._children ?? []).map(ref => ref.__id__); }

  /** Finds nodes whose path ends with `query` (`Panel/Close`), or whose name matches a /regex/. */
  find(query) {
    const regex = query.startsWith('/') && query.lastIndexOf('/') > 0
      ? new RegExp(query.slice(1, query.lastIndexOf('/')), query.slice(query.lastIndexOf('/') + 1)) : null;
    return this.nodeIndices().filter(i => {
      const path = this.nodePath(i);
      if (regex) { regex.lastIndex = 0; return regex.test(this.instanceName(i) ?? this.name(i)); }
      return path === query || path.endsWith(`/${query}`);
    });
  }

  /** `#12` is an index; anything else is a path query that must match exactly one node. */
  resolveNode(query) {
    if (/^#\d+$/.test(query)) {
      const index = Number(query.slice(1));
      if (!this.isNode(index)) throw new Error(`No node ${query} in ${rel(this.path)}`);
      return index;
    }
    const found = this.find(query);
    if (found.length === 1) return found[0];
    if (!found.length) throw new Error(`No node "${query}" in ${rel(this.path)}`);
    throw new Error(`"${query}" matches ${found.length} nodes:\n${found.map(i => `  #${i} ${this.nodePath(i)}`).join('\n')}`);
  }

  /** Who points at object `index`: [{from, path}] with `path` the property chain inside the referrer. */
  referrers(index) {
    const out = [];
    this.objects.forEach((object, from) => forEachRef(object, (ref, path) => {
      if (ref.__id__ === index) out.push({ from, path: path.join('.') });
    }));
    return out;
  }

  /** The node that owns object `index` (itself for nodes, `.node` for components). */
  ownerNode(index) {
    if (this.isNode(index)) return index;
    const node = this.objects[index]?.node?.__id__;
    return node !== undefined && this.isNode(node) ? node : undefined;
  }
}

/** Removes objects by index and renumbers every {__id__}. Refuses if a kept object still points at a removed one. */
export function removeObjects(objects, remove) {
  const map = new Map();
  let next = 0;
  objects.forEach((_, i) => { if (!remove.has(i)) map.set(i, next++); });
  const kept = structuredClone(objects.filter((_, i) => !remove.has(i)));
  kept.forEach(object => forEachRef(object, ref => {
    if (!isRef(ref)) return;
    if (!map.has(ref.__id__)) throw new Error(`Cannot remove #${ref.__id__}: it is still referenced`);
    ref.__id__ = map.get(ref.__id__);
  }));
  return kept;
}

export function serializeAsset(asset, original) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const text = JSON.stringify(asset.objects, null, 2).replaceAll('\n', eol);
  return original.endsWith('\n') ? text + eol : text;
}

/** Compare the original snapshot just before replacing the file. */
export function saveAsset(path, original, snapshot, text) {
  if (!snapshot.isFile()) throw new Error(`Cannot replace a non-regular file: ${rel(path)}`);
  const staged = `${path}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const fd = openSync(staged, 'wx', snapshot.mode);
    created = true;
    try { writeFileSync(fd, text); } finally { closeSync(fd); }
    const current = lstatSync(path);
    if (!current.isFile() || current.ino !== snapshot.ino || current.mtimeMs !== snapshot.mtimeMs
      || current.ctimeMs !== snapshot.ctimeMs || readFileSync(path, 'utf8') !== original) {
      throw new Error(`${rel(path)} changed since it was read. Review a new prune plan.`);
    }
    renameSync(staged, path);
    created = false;
  } finally {
    if (created) unlinkSync(staged);
  }
}

/** Loads nested prefab assets by UUID once. */
export class AssetCache {
  constructor(index) { this.index = index; this.cache = new Map(); }

  byUuid(uuid) {
    if (!this.cache.has(uuid)) {
      const entry = this.index.assets.get(uuid);
      const path = entry && /\.(prefab|scene)$/.test(entry.path) ? entry.path : null;
      this.cache.set(uuid, path && existsSync(path) ? SerializedAsset.load(path) : null);
    }
    return this.cache.get(uuid);
  }
}

/** Short readable form of a serialized value: refs become node paths, assets become file paths. */
export function describeValue(asset, index, value, depth = 0) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (isRef(value)) {
    const target = asset.objects[value.__id__];
    if (!target) return `#${value.__id__}(missing)`;
    const owner = asset.ownerNode(value.__id__);
    if (owner === value.__id__) return `→ ${asset.nodePath(owner)}`;
    if (owner !== undefined) return `→ ${asset.nodePath(owner)} <${typeName(index, target.__type__)}>`;
    return `#${value.__id__} <${target.__type__}>`;
  }
  if (typeof value.__uuid__ === 'string') {
    const entry = index?.assets.get(value.__uuid__);
    return entry ? `asset:${entry.origin === 'internal' ? 'internal/' : ''}${entry.origin === 'internal' ? toPosix(entry.path).split('/editor/assets/')[1] : rel(entry.path)}` : `asset:${value.__uuid__}(unknown)`;
  }
  if (Array.isArray(value)) return depth > 1 ? `[${value.length}]` : `[${value.map(v => describeValue(asset, index, v, depth + 1)).join(', ')}]`;
  const type = value.__type__;
  if (type === 'cc.Vec2' || type === 'cc.Vec3' || type === 'cc.Size' || type === 'cc.Color' || type === 'cc.Quat') {
    return `(${Object.entries(value).filter(([key]) => key !== '__type__').map(([, v]) => +Number(v).toFixed(3)).join(', ')})`;
  }
  if (depth > 1) return '{…}';
  return `{${Object.entries(value).filter(([key]) => key !== '__type__').map(([key, v]) => `${key}: ${describeValue(asset, index, v, depth + 1)}`).join(', ')}}`;
}

/** Returns the script file name for a compressed class ID or the original type name. */
export function typeName(index, type) {
  const script = index?.scripts.get(type);
  return script ? script.split(/[\\/]/).pop().replace(/\.[cm]?[jt]s$/, '') : type;
}
