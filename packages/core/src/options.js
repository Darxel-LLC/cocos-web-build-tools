function readValue(argv, index, flag) {
    const value = argv[index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    return value;
}

function parseBuildArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (["--platform", "--sdk-mode", "--version"].includes(arg)) {
            options[{ "--platform": "platform", "--sdk-mode": "sdkMode", "--version": "version" }[arg]] = readValue(argv, ++index, arg);
        } else if (arg.startsWith("--version=")) options.version = arg.slice(10);
        else if (arg === "--skip-build") options.skipBuild = true;
        else if (arg === "--no-compress") options.imageCompressionEnabled = false;
        else if (arg === "--no-obfuscate") options.scriptObfuscationEnabled = false;
        else if (arg === "--dry-run") options.dryRun = true;
        else if (arg === "--help" || arg === "-h") options.help = true;
        else if (arg.startsWith("-")) throw new Error(`Unknown argument: ${arg}`);
        else if (options.configName) throw new Error("Only one build config can be specified.");
        else options.configName = arg;
    }
    if (options.version !== undefined && validateVersion(options.version) !== true) throw new Error(validateVersion(options.version));
    return options;
}

function validateVersion(value) {
    return typeof value === "string" && /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(value)
        ? true : "Version must use only letters, numbers, dots, hyphens and underscores.";
}

function normalizeBuildConfig(config) {
    const post = config.postProcessing || {};
    for (const key of Object.keys(post)) {
        if (!["htmlOverlay", "imageCompression", "scriptObfuscation", "zip"].includes(key)) throw new Error(`Unknown post-processing stage: ${key}`);
    }
    const image = post.imageCompression || {};
    return {
        ...config,
        postProcessing: {
            htmlOverlay: { enabled: false, ...post.htmlOverlay },
            imageCompression: {
                enabled: false, overwritePolicy: "bigger", minSavings: "1%", ...image,
                parallelism: { pngThreads: 0, jpegConcurrency: 0, ...image.parallelism },
                png: { quality: 30, optimizationLevel: 6, ...image.png },
                jpg: { qualitySteps: [60, 70, 80, 90], minSsimulacra2Score: 60, ...image.jpg },
            },
            scriptObfuscation: { enabled: false, inputPath: "assets/main", ...post.scriptObfuscation },
            zip: { enabled: false, compressionLevel: 1, ...post.zip },
        },
    };
}

function printBuildHelp() {
    console.log(`Usage: cocos-web-build build <config> [options]
  --project <path>       Project root (default: current directory).
  --config-file <path>   Config path relative to project (default: cocos-build.config.cjs).
  --platform <name>      Platform from the project configuration.
  --sdk-mode <mode>      SDK mode accepted by the selected adapter.
  --version <version>    Archive version; otherwise use the project's version strategy.
  --skip-build          Process an existing Cocos output.
  --no-compress         Disable image compression.
  --no-obfuscate        Disable JavaScript obfuscation.
  --dry-run             Plan without writing build output; hooks receive dryRun=true.
  -h, --help            Show this help.`);
}

module.exports = { readValue, parseBuildArgs, validateVersion, normalizeBuildConfig, printBuildHelp };
