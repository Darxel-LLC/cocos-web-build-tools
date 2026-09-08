const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createPlatformTools } = require("./platforms.js");
const { createCocosTools } = require("./cocos/build.js");
const { createImageTools } = require("./images.js");
const { createPostProcessingTools } = require("./post-process.js");
const { validateBuildConfig, resolveBuildOutputName } = require("./validation.js");
const { normalizeBuildConfig, validateVersion } = require("./options.js");

function resolveVersion(context, explicitVersion) {
    if (explicitVersion !== undefined) return explicitVersion;
    if (typeof context.config.resolveVersion === "function") return context.config.resolveVersion(context);
    if (context.config.versionStrategy === "git-zero-minor") {
        let tags = "";
        try {
            tags = execFileSync("git", ["tag"], { cwd: context.projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        } catch { /* A fresh project has no tags yet. */ }
        const minors = tags.split(/\r?\n/).map(tag => /^0\.(\d+)$/.exec(tag.trim())).filter(Boolean).map(match => Number(match[1]));
        return `0.${Math.max(0, ...minors) + 1}`;
    }
    return context.packageJson.version || "0.1.0";
}

async function build(context, cliOptions) {
    const configs = context.config.configs;
    const configName = cliOptions.configName;
    if (!Object.hasOwn(configs, configName)) throw new Error(`Choose a build config: ${Object.keys(configs).join(", ")}. Received: ${configName ?? "<none>"}`);
    const config = normalizeBuildConfig(configs[configName]);
    if (cliOptions.imageCompressionEnabled === false) config.postProcessing.imageCompression.enabled = false;
    if (cliOptions.scriptObfuscationEnabled === false) config.postProcessing.scriptObfuscation.enabled = false;
    validateBuildConfig(configName, config);
    const platforms = createPlatformTools({ projectRoot: context.projectRoot, platforms: context.config.platforms });
    const platform = cliOptions.platform || context.config.defaultPlatform || "local";
    const adapter = platforms.getPlatformDefinition(platform);
    const target = platforms.resolvePlatformTarget(platform, config.mode || configName, cliOptions.sdkMode);
    const outputSuffix = platforms.getPlatformDefinition(platform).outputSuffix;
    const outputName = resolveBuildOutputName(config) + outputSuffix;
    const version = resolveVersion(context, cliOptions.version);
    if (validateVersion(version) !== true) throw new Error(validateVersion(version));
    const options = {
        target, configName, version, outputName,
        buildOptions: {
            ...config.buildOptions,
            buildPath: `project://${path.relative(context.projectRoot, context.buildRoot).split(path.sep).join("/")}`,
            outputName,
        },
        postProcessing: config.postProcessing,
        dryRun: Boolean(cliOptions.dryRun), skipBuild: Boolean(cliOptions.skipBuild),
    };
    options.postProcessing.zip.archiveName = (options.postProcessing.zip.archiveName || outputName) + (options.postProcessing.zip.archiveName ? outputSuffix : "");
    const buildPath = context.resolveBuildRootPath(outputName);
    const cocos = createCocosTools(context);
    const images = createImageTools(context);
    const post = createPostProcessingTools(context);
    const hookContext = { ...context, ...options, buildPath, adapter };
    cocos.formatCocosBuildOptions(options.buildOptions);
    if (options.postProcessing.zip.enabled) post.resolveZipPath(version, options);
    await adapter.validate?.(hookContext);
    await context.config.hooks?.beforeBuild?.(hookContext);
    await adapter.prepareBuild?.(hookContext);
    // Adapters can adjust Creator options, but the pipeline owns its output paths.
    options.buildOptions.outputName = outputName;
    options.buildOptions.buildPath = `project://${path.relative(context.projectRoot, context.buildRoot).split(path.sep).join("/")}`;
    const cocosOptionsText = cocos.formatCocosBuildOptions(options.buildOptions);
    platforms.validatePlatformFiles(target);
    if (!options.skipBuild) cocos.validateCocosBuild(options);
    for (const [stage, fields] of Object.entries({
        htmlOverlay: ["templatePath"],
        imageCompression: ["toolPath", "ssimulacra2ToolPath"],
        scriptObfuscation: ["configPath"],
        zip: ["toolPath"],
    })) {
        const settings = options.postProcessing[stage];
        if (!settings.enabled) continue;
        for (const field of fields) {
            const filename = context.resolveProjectPath(settings[field]);
            if (!fs.existsSync(filename)) throw new Error(`${stage}.${field} not found: ${filename}`);
        }
    }
    console.log(`Building ${context.packageJson.name || path.basename(context.projectRoot)} for ${platform} (${target.sdkMode})`);
    console.log(`Build config: ${configName}\nBuild version: ${version}\nCocos build options: ${cocosOptionsText}\nDry run: ${options.dryRun}`);
    if (!options.skipBuild) {
        if (fs.existsSync(buildPath)) {
            console.log(`${options.dryRun ? "Would remove" : "Removing"} existing build output: ${buildPath}`);
            if (!options.dryRun) fs.rmSync(context.resolveBuildRootPath(outputName), { recursive: true, force: true });
        }
        cocos.runCocosBuild(options);
    } else console.log("Skipping Cocos Creator build");
    if (!options.dryRun && !fs.existsSync(buildPath)) throw new Error(`Build output not found: ${buildPath}`);
    if (!options.dryRun) fs.rmSync(context.resolveInside(buildPath, "platform-target.json"), { force: true });
    platforms.preparePlatformBuild(buildPath, target, options.dryRun);
    await adapter.processBuild?.(hookContext);
    await context.config.hooks?.preparePlatform?.(hookContext);
    post.processHtmlOverlay(buildPath, options);
    const summary = options.postProcessing.imageCompression.enabled
        ? await images.compressImages(buildPath, options)
        : images.createSkippedImageCompressionSummary("disabled");
    if (options.postProcessing.scriptObfuscation.enabled) post.obfuscateMainBundle(buildPath, options);
    await context.config.hooks?.afterProcess?.(hookContext);
    platforms.writeTargetManifest(buildPath, target, options.dryRun);
    let archivePath;
    if (options.postProcessing.zip.enabled) {
        archivePath = post.resolveZipPath(version, options);
        post.zipBuild(buildPath, version, options);
    }
    images.printImageCompressionSummary(summary);
    console.log(`Platform build completed: ${archivePath || buildPath}`);
    console.log(`Build finished at: ${new Date().toISOString()}`);
    return { buildPath, archivePath, target, version, dryRun: options.dryRun };
}

module.exports = { build };
