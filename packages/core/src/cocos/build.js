const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createProcessTools } = require("../process.js");

function createCocosTools(context) {
    const { projectRoot: PROJECT_ROOT, resolveBuildRootPath } = context;
    const { formatCommand } = createProcessTools(context);
    function validateCocosBuild(options) {
        const cocosPath = context.resolveProjectPath(process.env.COCOS_CREATOR_PATH || context.config.cocos?.executable || defaultCreatorPath());
        if (!options.dryRun && !fs.existsSync(cocosPath)) {
            throw new Error(`Cocos Creator executable not found: ${cocosPath}. Set COCOS_CREATOR_PATH to override it.`);
        }

        validateCocosBuildOptions(options);

        const args = [
            "--project",
            PROJECT_ROOT,
            "--build",
            formatCocosBuildOptions(options.buildOptions),
        ];
        return { cocosPath, args };
    }

    function runCocosBuild(options) {
        const { cocosPath, args } = validateCocosBuild(options);

        console.log(formatCommand(cocosPath, args));

        if (options.dryRun) {
            return;
        }

        const startedAt = Date.now();
        const result = spawnSync(cocosPath, args, {
            cwd: PROJECT_ROOT,
            stdio: "inherit",
            windowsHide: true,
        });

        if (result.error) {
            throw result.error;
        }

        if (result.status !== 0) {
            const expectedBuildPath = resolveBuildRootPath(options.outputName);
            if (result.status === 36 && fs.existsSync(path.join(expectedBuildPath, "index.html"))
                && findNewestMtimeMs(expectedBuildPath) >= startedAt - 1000) {
                console.log("Cocos Creator completed the command-line build (exit code 36).");
                return;
            }

            throw new Error(`Command failed with exit code ${result.status}: ${formatCommand(cocosPath, args)}`);
        }
    }

    function validateCocosBuildOptions(options) {
        const configPath = options.buildOptions.configPath;
        if (!configPath) {
            return;
        }

        const absoluteConfigPath = path.isAbsolute(configPath)
            ? configPath
            : path.resolve(PROJECT_ROOT, configPath);

        if (!fs.existsSync(absoluteConfigPath)) {
            throw new Error(`Cocos build config not found: ${absoluteConfigPath}`);
        }
    }

    function formatCocosBuildOptions(buildOptions) {
        return Object.entries(buildOptions)
            .map(([key, value]) => {
                if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) throw new Error(`Invalid Cocos option name: ${key}`);
                return `${key}=${formatCocosBuildValue(value)}`;
            })
            .join(";");
    }

    function formatCocosBuildValue(value) {
        if (!["string", "number", "boolean"].includes(typeof value) || /[;\r\n]/.test(String(value))) {
            throw new Error("Cocos CLI option values must be scalar values without semicolons or newlines. Use a configPath JSON file for complex settings.");
        }
        if (typeof value === "boolean") {
            return value ? "true" : "false";
        }
        return String(value);
    }
    function findNewestMtimeMs(rootPath) {
        let newest = fs.statSync(rootPath).mtimeMs;
        const entries = fs.readdirSync(rootPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = path.join(rootPath, entry.name);
            const stats = fs.statSync(entryPath);
            newest = Math.max(newest, stats.mtimeMs);
            if (entry.isDirectory()) {
                newest = Math.max(newest, findNewestMtimeMs(entryPath));
            }
        }

        return newest;
    }

    function defaultCreatorPath() {
        const version = context.config.cocos?.version || context.packageJson.creator?.version;
        if (!version || process.platform !== "win32") {
            throw new Error("Set COCOS_CREATOR_PATH or cocos.executable in your build config.");
        }
        return path.join(process.env.ProgramData || "C:/ProgramData", "cocos", "editors", "Creator", version, "CocosCreator.exe");
    }
    return { runCocosBuild, validateCocosBuild, formatCocosBuildOptions };
}

module.exports = { createCocosTools };
