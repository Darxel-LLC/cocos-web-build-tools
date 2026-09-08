const fs = require("node:fs");
const path = require("node:path");
const { createPlatformTools } = require("./platforms.js");

function getPlatformActions(adapter) {
    const actions = [{ name: "Build only", value: "build-only" }];
    if (adapter.preview) actions.push(
        { name: "Build and run locally", value: "build-and-serve" },
        { name: "Run an existing build", value: "serve-only" },
    );
    if (adapter.deploy) actions.push(
        { name: `Build and deploy to ${adapter.label}`, value: "build-and-deploy" },
        { name: `Deploy an existing build to ${adapter.label}`, value: "deploy-only" },
    );
    return actions;
}

function createActionContext(context, { configName, platform = context.config.defaultPlatform || "local", ...options }) {
    const { getPlatformDefinition, resolvePlatformTarget } = createPlatformTools({ projectRoot: context.projectRoot, platforms: context.config.platforms });
    const adapter = getPlatformDefinition(platform);
    if (!Object.hasOwn(context.config.configs, configName)) throw new Error(`Unknown build config: ${configName}`);
    const config = context.config.configs[configName];
    const outputName = config.buildOutputName || config.buildOptions?.outputName;
    if (typeof outputName !== "string" || !outputName) throw new Error(`Missing output name: ${configName}`);
    const buildPath = context.resolveBuildRootPath(outputName + adapter.outputSuffix);
    const target = JSON.parse(fs.readFileSync(path.join(buildPath, "platform-target.json"), "utf8"));
    if (!fs.existsSync(path.join(buildPath, "index.html")) || target.platform !== platform || target.mode !== (config.mode || configName)) throw new Error("Build target does not match the selected action. Rebuild first.");
    resolvePlatformTarget(platform, target.mode, target.sdkMode);
    return { ...context, ...options, configName, mode: target.mode, platform, adapter, buildPath, target, dryRun: false };
}

async function previewBuild(context, options) {
    const action = createActionContext(context, options);
    if (!action.adapter.preview) throw new Error(`Preview is not implemented for ${action.platform}.`);
    const handle = await action.adapter.preview(action);
    if (!handle || typeof handle.close !== "function") throw new Error(`${action.platform}.preview must return a handle with close().`);
    return handle;
}

async function deployBuild(context, options) {
    const action = createActionContext(context, options);
    if (!action.adapter.deploy) throw new Error(`Deployment is not implemented for ${action.platform}.`);
    return action.adapter.deploy(action);
}

module.exports = { getPlatformActions, createActionContext, previewBuild, deployBuild };
