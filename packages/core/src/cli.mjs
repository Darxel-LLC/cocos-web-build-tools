import fs from "node:fs";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import { createPlatformTools } from "./platforms.js";
import { loadProject } from "./context.js";
import { build as buildProject } from "./build.js";
import { getPlatformActions, previewBuild, deployBuild } from "./actions.js";

export async function runCli(fixedPlatform, projectOptions = {}) {
    const context = loadProject(projectOptions);
    const PROJECT_ROOT = context.projectRoot;
    const METADATA_PATH = context.metadataPath;
    const { platformDefinitions, getPlatformDefinition } = createPlatformTools({ projectRoot: PROJECT_ROOT, platforms: context.config.platforms });
    const defaultPlatform = context.config.defaultPlatform || "local";
    const DEFAULT_METADATA = {
        version: context.config.defaultVersion || context.packageJson.version || "0.1.0",
        config: Object.hasOwn(context.config.configs, "dev") ? "dev" : Object.keys(context.config.configs)[0],
        port: 12333,
        platform: defaultPlatform,
    };
    async function runMenu(fixedPlatform) {
        const configs = readBuildConfigs();
        const metadata = readMetadata(configs);
        const platform = fixedPlatform ?? await select({
            message: "Target platform:",
            choices: Object.entries(platformDefinitions).map(([value, definition]) => ({ name: definition.label, value })),
            default: metadata.platform ?? defaultPlatform,
        });
        const platformDefinition = getPlatformDefinition(platform);
        const action = await select({
            message: "What do you want to do?",
            choices: getPlatformActions(platformDefinition),
            default: platformDefinition.deploy || !platformDefinition.preview ? "build-only" : "build-and-serve",
        });
        const configName = await select({
            message: "Build configuration:",
            choices: Object.keys(configs).map((name) => ({
                name,
                value: name,
                description: `Output: build/${resolveBuildOutputName(name, configs[name])}${platformDefinition.outputSuffix}`,
            })),
            default: metadata.config,
        });

        const shouldBuild = ["build-and-serve", "build-only", "build-and-deploy"].includes(action);
        const shouldServe = ["build-and-serve", "serve-only"].includes(action);
        const shouldDeploy = ["build-and-deploy", "deploy-only"].includes(action);
        let version = metadata.version;
        if (shouldBuild) {
            version = await input({
                message: "Build version:",
                default: metadata.version,
                required: true,
                validate: validateVersion,
            });
            version = version.trim();
        }

        let port = metadata.port;
        if (shouldServe) {
            const portInput = await input({
                message: "Local server port:",
                default: String(metadata.port),
                required: true,
                validate: validatePort,
            });
            port = Number.parseInt(portInput, 10);
        }

        writeMetadata({ ...metadata, version, config: configName, port, platform });

        if (shouldBuild) {
            await runBuild(configName, version, platform);
        }

        if (shouldDeploy) await deployBuild(context, { configName, platform });
        if (shouldServe) {
            const handle = await previewBuild(context, { configName, platform, port, host: "0.0.0.0" });
            if (handle.finished) await handle.finished;
        }
    }

    function readBuildConfigs() {
        const configFile = context.config;
        if (!configFile.configs || typeof configFile.configs !== "object") {
            throw new Error(`${context.configPath} must contain a top-level \"configs\" object.`);
        }

        const configEntries = Object.entries(configFile.configs);
        if (configEntries.length === 0) {
            throw new Error(`${context.configPath} does not contain any build configurations.`);
        }

        for (const [name, config] of configEntries) {
            resolveBuildOutputName(name, config);
        }
        return configFile.configs;
    }

    function readMetadata(configs) {
        if (!fs.existsSync(METADATA_PATH)) {
            return { ...DEFAULT_METADATA };
        }

        let metadata;
        try {
            metadata = readJsonFile(METADATA_PATH, "build metadata");
        } catch (error) {
            console.warn(`${error.message} Using default values.`);
            return { ...DEFAULT_METADATA };
        }

        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
            console.warn(`${METADATA_PATH} must contain a JSON object. Using default values.`);
            return { ...DEFAULT_METADATA };
        }

        const fallbackConfig = Object.hasOwn(configs, DEFAULT_METADATA.config)
            ? DEFAULT_METADATA.config
            : Object.keys(configs)[0];

        return {
            ...metadata,
            platform: Object.hasOwn(platformDefinitions, metadata.platform) ? metadata.platform : defaultPlatform,
            version: validateVersion(metadata.version) === true
                ? metadata.version.trim()
                : DEFAULT_METADATA.version,
            config: Object.hasOwn(configs, metadata.config)
                ? metadata.config
                : fallbackConfig,
            port: validatePort(metadata.port) === true
                ? Number(metadata.port)
                : DEFAULT_METADATA.port,
        };
    }

    function readJsonFile(filePath, description) {
        try {
            return JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (error) {
            throw new Error(`Failed to read ${description} file ${filePath}: ${error.message}`);
        }
    }

    function writeMetadata(metadata) {
        fs.mkdirSync(path.dirname(METADATA_PATH), { recursive: true });
        fs.writeFileSync(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    }

    function resolveBuildOutputName(configName, config) {
        const outputName = config?.buildOutputName || config?.buildOptions?.outputName;
        if (typeof outputName !== "string" || outputName.length === 0) {
            throw new Error(`Build config \"${configName}\" must define buildOutputName or buildOptions.outputName.`);
        }
        context.resolveBuildRootPath(outputName);
        return outputName;
    }

    function validateVersion(value) {
        const version = typeof value === "string" ? value.trim() : "";
        if (!version) {
            return "Build version is required.";
        }
        if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(version)) {
            return "Use only letters, numbers, dots, hyphens, and underscores.";
        }
        return true;
    }

    function validatePort(value) {
        const normalized = typeof value === "number" ? String(value) : value?.trim();
        if (!/^\d+$/.test(normalized ?? "")) {
            return "Port must be an integer from 1 to 65535.";
        }
        const port = Number(normalized);
        return port >= 1 && port <= 65535
            ? true
            : "Port must be an integer from 1 to 65535.";
    }

    async function runBuild(configName, version, platform) {
        await buildProject(context, { configName, version, platform });
    }

    return runMenu(fixedPlatform);
}

export function reportCliError(error) {
    if (error?.name === "ExitPromptError") {
        console.log("\nCancelled.");
        return;
    }

    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}

