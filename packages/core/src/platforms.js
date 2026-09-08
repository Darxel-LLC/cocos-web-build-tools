const fs = require("node:fs");
const path = require("node:path");
const { resolveInside } = require("./context.js");

const ADAPTER_API_VERSION = 1;
const lifecycleMethods = ["resolveTarget", "validate", "prepareBuild", "processBuild", "preview", "deploy"];

function definePlatform(definition) {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("A platform adapter must be an object.");
    const adapter = { apiVersion: ADAPTER_API_VERSION, outputSuffix: "", files: {}, ...definition };
    if (typeof adapter.id !== "string") throw new Error("Platform id must be a string.");
    if (!/^[a-z][a-z0-9-]*$/.test(adapter.id)) throw new Error(`Invalid platform id: ${adapter.id}`);
    if (adapter.apiVersion !== ADAPTER_API_VERSION) throw new Error(`Unsupported adapter API version for ${adapter.id}: ${adapter.apiVersion}. Expected ${ADAPTER_API_VERSION}.`);
    if (typeof adapter.label !== "string" || !adapter.label.trim()) throw new Error(`Platform ${adapter.id} must have a label.`);
    if (typeof adapter.outputSuffix !== "string" || /[\\/;\r\n]/.test(adapter.outputSuffix)) throw new Error(`Invalid outputSuffix: ${adapter.id}`);
    if (!adapter.files || typeof adapter.files !== "object" || Array.isArray(adapter.files)) throw new Error(`Invalid platform files: ${adapter.id}`);
    for (const method of lifecycleMethods) {
        if (adapter[method] !== undefined && typeof adapter[method] !== "function") throw new Error(`${adapter.id}.${method} must be a function.`);
    }
    return Object.freeze(adapter);
}

function local(options = {}) {
    return definePlatform({
        ...options, id: "local", label: options.label || "Local", apiVersion: ADAPTER_API_VERSION,
        resolveTarget({ mode, sdkMode }) {
            sdkMode ??= options.defaultSdkMode?.[mode] || "real";
            if (sdkMode !== "real" && sdkMode !== "mock") throw new Error(`Unsupported local SDK mode: ${sdkMode}`);
            if (sdkMode === "mock" && mode !== "dev") throw new Error("Mock services are allowed only for local dev builds.");
            return { sdkMode };
        },
        async preview(context) {
            const { startStaticServer } = await import("./static-preview.mjs");
            const server = await startStaticServer(context.buildPath, context);
            return { close: () => new Promise((resolve, reject) => {
                server.closeAllConnections();
                server.close(error => error ? reject(error) : resolve());
            }) };
        },
    });
}

function createPlatformTools({ projectRoot, platforms = [] }) {
    if (!Array.isArray(platforms)) throw new Error("platforms must be an array of adapter instances. Use local(), an adapter package, or definePlatform().");
    const platformDefinitions = Object.create(null);
    platformDefinitions.local = local();
    const seen = new Set();
    for (const value of platforms) {
        if (value?.apiVersion === undefined) throw new Error("Platform adapter apiVersion is required. Use definePlatform().");
        const adapter = definePlatform(value);
        if (seen.has(adapter.id)) throw new Error(`Duplicate platform id: ${adapter.id}`);
        seen.add(adapter.id);
        platformDefinitions[adapter.id] = adapter;
    }

    function getPlatformDefinition(platform) {
        if (!Object.hasOwn(platformDefinitions, platform)) throw new Error(`Unsupported platform: ${platform}. Available: ${Object.keys(platformDefinitions).join(", ")}. Install and register its adapter.`);
        return platformDefinitions[platform];
    }

    function resolvePlatformTarget(platform, mode, requestedSdkMode) {
        const adapter = getPlatformDefinition(platform);
        if (mode !== "dev" && mode !== "release") throw new Error(`Unsupported build mode: ${mode}. Set config.mode to dev or release.`);
        const result = adapter.resolveTarget
            ? adapter.resolveTarget({ platform, mode, sdkMode: requestedSdkMode })
            : { sdkMode: requestedSdkMode || "real", ...(adapter.sdkUrl ? { sdkUrl: adapter.sdkUrl } : {}) };
        if (!result || typeof result !== "object" || typeof result.then === "function" || Array.isArray(result)) throw new Error(`${platform}.resolveTarget must synchronously return public target settings.`);
        if (typeof result.sdkMode !== "string" || !result.sdkMode) throw new Error(`${platform}.resolveTarget must return sdkMode.`);
        return { ...result, platform, mode };
    }

    function validatePlatformFiles(target) {
        for (const [name, source] of Object.entries(getPlatformDefinition(target.platform).files)) {
            if (!name || name === "." || name === ".." || /[\\/]/.test(name) || path.basename(name) !== name) throw new Error(`Platform output file must have a plain filename: ${name}`);
            if (["index.html", "platform-target.json"].includes(name.toLowerCase())) throw new Error(`Reserved platform filename: ${name}`);
            if (typeof source !== "string" || !fs.existsSync(path.resolve(projectRoot, source))) throw new Error(`Platform file is missing: ${source}`);
        }
    }

    function preparePlatformBuild(buildPath, target, dryRun) {
        const definition = getPlatformDefinition(target.platform);
        validatePlatformFiles(target);
        if (dryRun) {
            console.log(`Would configure platform: ${JSON.stringify(target)}`);
            for (const name of Object.keys(definition.files)) console.log(`Would copy platform file: ${name}`);
            return;
        }
        if (!fs.existsSync(path.join(buildPath, "index.html"))) throw new Error(`Build index.html not found: ${buildPath}`);
        if (definition.screen) {
            const srcPath = resolveInside(buildPath, "src");
            const settingsFiles = fs.readdirSync(srcPath).filter(name => /^settings(?:\.[a-f0-9]+)?\.json$/.test(name));
            if (settingsFiles.length !== 1) throw new Error("Expected one Cocos settings file for platform screen configuration.");
            const settingsPath = resolveInside(srcPath, settingsFiles[0]);
            const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
            settings.screen = { ...settings.screen, ...definition.screen };
            fs.writeFileSync(settingsPath, JSON.stringify(settings));
        }
        for (const [name, source] of Object.entries(definition.files)) {
            fs.copyFileSync(path.resolve(projectRoot, source), resolveInside(buildPath, name));
            console.log(`Copied platform file: ${name}`);
        }
    }

    function writeTargetManifest(buildPath, target, dryRun) {
        if (!dryRun) fs.writeFileSync(resolveInside(buildPath, "platform-target.json"), `${JSON.stringify(target, null, 2)}\n`);
        console.log(`${dryRun ? "Would record" : "Configured"} ${target.platform}/${target.mode}/${target.sdkMode}.`);
    }

    return { platformDefinitions, getPlatformDefinition, resolvePlatformTarget, validatePlatformFiles, preparePlatformBuild, writeTargetManifest };
}

module.exports = { ADAPTER_API_VERSION, definePlatform, local, createPlatformTools };
