import { loadProject } from "./context.js";
import { readValue } from "./options.js";
import { previewBuild } from "./actions.js";
export { startStaticServer } from "./static-preview.mjs";

export async function runPreview(args = process.argv.slice(2), projectOptions = {}) {
    if (args.includes("--help") || args.includes("-h")) {
        console.log("Usage: cocos-web-build preview [config] [--platform name] [--port 12333] [--host 0.0.0.0]");
        return;
    }
    const context = loadProject(projectOptions);
    let configName;
    let platform = context.config.previewPlatform || context.config.defaultPlatform || "local";
    let port = 12333;
    let host = "0.0.0.0";
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--platform") platform = readValue(args, ++index, arg);
        else if (arg === "--port") port = Number(readValue(args, ++index, arg));
        else if (arg === "--host") host = readValue(args, ++index, arg);
        else if (arg.startsWith("-") || configName) throw new Error(`Unknown preview argument: ${arg}`);
        else configName = arg;
    }
    configName ||= Object.hasOwn(context.config.configs, "dev") ? "dev" : Object.keys(context.config.configs)[0];
    return previewBuild(context, { configName, platform, port, host });
}
