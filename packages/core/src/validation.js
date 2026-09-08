function validateBuildConfig(configName, config) {
    if (!config || typeof config !== "object") {
        throw new Error(`Build config "${configName}" must be an object.`);
    }

    if (!config.buildOptions || typeof config.buildOptions !== "object") {
        throw new Error(`Build config "${configName}" must contain buildOptions.`);
    }

    if (!config.buildOptions.configPath && !config.buildOptions.platform) {
        throw new Error(`Build config "${configName}" must contain buildOptions.platform or buildOptions.configPath.`);
    }

    if (!resolveBuildOutputName(config)) {
        throw new Error(`Build config "${configName}" must contain buildOutputName or buildOptions.outputName.`);
    }

    if (!config.postProcessing || typeof config.postProcessing !== "object") {
        throw new Error(`Build config "${configName}" must contain postProcessing.`);
    }

    const postProcessing = config.postProcessing;
    validatePostProcessingConfig(configName, postProcessing);
}

function validatePostProcessingConfig(configName, postProcessing) {
    for (const [stage, settings] of Object.entries(postProcessing)) {
        requireConfigObject(configName, settings, `postProcessing.${stage}`);
        requireEnabled(configName, settings, `postProcessing.${stage}`);
    }
    const { htmlOverlay, imageCompression, scriptObfuscation, zip } = postProcessing;
    if (htmlOverlay.enabled) requireString(configName, htmlOverlay.templatePath, "htmlOverlay.templatePath");
    if (htmlOverlay.markers && (!htmlOverlay.markers.start || !htmlOverlay.markers.end)) {
        throw new Error("htmlOverlay.markers must include non-empty start and end strings.");
    }
    if (imageCompression.enabled) {
        requireString(configName, imageCompression.toolPath, "imageCompression.toolPath");
        requireString(configName, imageCompression.ssimulacra2ToolPath, "imageCompression.ssimulacra2ToolPath");
        requireString(configName, imageCompression.overwritePolicy, "imageCompression.overwritePolicy");
        requirePercentageString(configName, imageCompression.minSavings, "imageCompression.minSavings");
        requireIntegerInRange(configName, imageCompression.parallelism.pngThreads, "imageCompression.parallelism.pngThreads", 0, 256);
        requireIntegerInRange(configName, imageCompression.parallelism.jpegConcurrency, "imageCompression.parallelism.jpegConcurrency", 0, 256);
        requireIntegerInRange(configName, imageCompression.png.quality, "imageCompression.png.quality", 1, 100);
        requireIntegerInRange(configName, imageCompression.png.optimizationLevel, "imageCompression.png.optimizationLevel", 0, 6);
        requireIncreasingIntegerArray(configName, imageCompression.jpg.qualitySteps, "imageCompression.jpg.qualitySteps", 1, 100);
        requireNumberInRange(configName, imageCompression.jpg.minSsimulacra2Score, "imageCompression.jpg.minSsimulacra2Score", 0, 100);
    }
    if (scriptObfuscation.enabled) requireString(configName, scriptObfuscation.configPath, "scriptObfuscation.configPath");
    if (zip.enabled) {
        requireString(configName, zip.toolPath, "zip.toolPath");
        requireString(configName, zip.archiveName, "zip.archiveName");
        requireIntegerInRange(configName, zip.compressionLevel, "zip.compressionLevel", 0, 9);
    }
}

function requireConfigObject(configName, value, propertyPath) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Build config "${configName}" must contain ${propertyPath}.`);
    }
    return value;
}

function requireEnabled(configName, value, propertyPath) {
    if (typeof value.enabled !== "boolean") {
        throw new Error(`Build config "${configName}" ${propertyPath}.enabled must be a boolean.`);
    }
}

function requireString(configName, value, propertyPath) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Build config "${configName}" ${propertyPath} must be a non-empty string.`);
    }
}

function requirePercentageString(configName, value, propertyPath) {
    if (typeof value !== "string" || !/^\d+(?:\.\d+)?%$/.test(value)) {
        throw new Error(`Build config "${configName}" ${propertyPath} must be a non-negative percentage such as "1%".`);
    }
}

function requireIntegerInRange(configName, value, propertyPath, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`Build config "${configName}" ${propertyPath} must be an integer from ${min} to ${max}.`);
    }
}

function requireNumberInRange(configName, value, propertyPath, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        throw new Error(`Build config "${configName}" ${propertyPath} must be a number from ${min} to ${max}.`);
    }
}

function requireIncreasingIntegerArray(configName, value, propertyPath, min, max) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`Build config "${configName}" ${propertyPath} must be a non-empty array.`);
    }

    for (let index = 0; index < value.length; index++) {
        requireIntegerInRange(configName, value[index], `${propertyPath}[${index}]`, min, max);
        if (index > 0 && value[index] <= value[index - 1]) {
            throw new Error(`Build config "${configName}" ${propertyPath} must contain strictly increasing values.`);
        }
    }
}

function resolveBuildOutputName(config) { return config.buildOutputName || config.buildOptions?.outputName; }
module.exports = { validateBuildConfig, resolveBuildOutputName };
