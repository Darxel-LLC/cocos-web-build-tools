const fs = require("node:fs");
const path = require("node:path");

function resolveInside(root, ...segments) {
    const resolved = path.resolve(root, ...segments);
    const relative = path.relative(root, resolved);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Refusing to use path outside root ${root}: ${resolved}`);
    }
    // Output cleanup must never follow a junction into another directory.
    let current = root;
    for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
            throw new Error(`Refusing to use linked output path: ${current}`);
        }
    }
    return resolved;
}

function loadProject({ projectRoot = process.cwd(), configFile = "cocos-build.config.cjs", config } = {}) {
    projectRoot = fs.realpathSync(projectRoot);
    const configPath = path.resolve(projectRoot, configFile);
    if (!config) {
        if (!fs.existsSync(configPath)) throw new Error(`Build configuration not found: ${configPath}`);
        config = require(configPath);
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Build config must export an object.");
    if (!config.configs || typeof config.configs !== "object" || Array.isArray(config.configs) || !Object.keys(config.configs).length) {
        throw new Error("Build config must contain a non-empty configs object.");
    }
    const packagePath = path.join(projectRoot, "package.json");
    const packageJson = fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, "utf8")) : {};
    const buildRoot = resolveInside(projectRoot, config.buildRoot || "build");
    const metadataPath = resolveInside(projectRoot, config.metadataPath || ".cocos-build/state.json");
    return {
        projectRoot, configPath, config, packageJson, buildRoot, metadataPath,
        resolveInside,
        resolveProjectPath: value => path.resolve(projectRoot, value),
        resolveBuildRootPath: (...segments) => {
            resolveInside(projectRoot, path.relative(projectRoot, buildRoot));
            return resolveInside(buildRoot, ...segments);
        },
    };
}

module.exports = { loadProject, resolveInside };
