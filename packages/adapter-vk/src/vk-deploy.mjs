import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { confirm, input, select } from "@inquirer/prompts";


export async function deployVkBuild({ buildPath, configName, mode = configName, projectRoot = process.cwd() }) {
    const PROJECT_ROOT = fs.realpathSync(projectRoot);
    const HOSTING_CONFIG_PATH = path.join(PROJECT_ROOT, "vk-hosting-config.json");
    const targetPath = path.join(buildPath, "platform-target.json");
    if (!fs.existsSync(targetPath) || !fs.existsSync(path.join(buildPath, "index.html"))) {
        throw new Error(`Build output is missing or incomplete. Build VK ${configName} first: ${buildPath}`);
    }
    const target = JSON.parse(fs.readFileSync(targetPath, "utf8"));
    if (target.platform !== "vk" || target.mode !== mode || target.sdkMode !== "real") {
        throw new Error(`Expected a VK ${configName} build with the real SDK. Rebuild ${buildPath}.`);
    }

    const hosting = JSON.parse(fs.readFileSync(HOSTING_CONFIG_PATH, "utf8"));
    const appId = Number(await input({
        message: "VK application ID:",
        default: String(hosting.app_id ?? ""),
        required: true,
        validate: value => /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) && Number(value) > 0
            ? true : "Enter a positive numeric application ID.",
    }));
    const environment = await select({
        message: "VK hosting environment:",
        choices: [
            { name: "Development — update dev URLs", value: "dev" },
            {
                name: "Production — update production and dev URLs",
                value: "production",
                disabled: mode !== "release" ? "Requires a release build" : false,
            },
        ],
        default: "dev",
    });
    const staticPath = path.relative(PROJECT_ROOT, buildPath).split(path.sep).join("/");
    console.log(`\nVK app: https://vk.com/app${appId}`);
    console.log(`Build: ${configName} (${staticPath})`);
    console.log(`Hosting: ${environment}; update ${environment === "dev" ? "dev URLs only" : "production and dev URLs"}.`);
    console.log("All build files, including audio, will be uploaded.\n");
    if (!await confirm({ message: "Upload this build and update the selected URLs?", default: false })) {
        console.log("Deployment cancelled.");
        return;
    }

    const config = {
        app_id: appId,
        static_path: staticPath,
        endpoints: { mobile: "index.html", web: "index.html", mvk: "index.html" },
        update_prod: environment === "production",
        update_dev: true,
    };
    // Upstream caches cwd-relative configuration and can call process.exit().
    // Isolate it so the caller's cwd, require cache and environment stay intact.
    await new Promise((resolve, reject) => {
        const worker = fileURLToPath(new URL("./vk-upload.cjs", import.meta.url));
        const child = spawn(process.execPath, [worker, JSON.stringify(config)], {
            cwd: PROJECT_ROOT, stdio: "inherit", windowsHide: true,
            env: { ...process.env, MINI_APPS_ENVIRONMENT: environment, MINI_APPS_APP_ID: String(appId) },
        });
        child.once("error", reject);
        child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`VK deployment failed: ${signal || code}`)));
    });
}
