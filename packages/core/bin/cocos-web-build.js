#!/usr/bin/env node
const { readValue } = require("../src/options.js");

async function main() {
    const args = process.argv.slice(2);
    const projectOptions = {};
    const remaining = [];
    for (let index = 0; index < args.length; index++) {
        if (args[index] === "--project") projectOptions.projectRoot = readValue(args, ++index, "--project");
        else if (args[index] === "--config-file") projectOptions.configFile = readValue(args, ++index, "--config-file");
        else remaining.push(args[index]);
    }
    const command = remaining.shift() || "menu";
    if (command === "--help" || command === "-h") {
        console.log("Usage: cocos-web-build <build|preview|menu> [arguments] [--project <path>] [--config-file <path>]\nRun cocos-web-build build --help for build options.");
    } else if (command === "build") {
        await require("../src/index.js").runBuild(remaining, projectOptions);
    } else if (command === "preview") {
        const handle = await (await import("../src/preview.mjs")).runPreview(remaining, projectOptions);
        if (handle?.finished) await handle.finished;
    } else if (command === "menu") {
        let platform;
        if (remaining.length) {
            if (remaining[0] !== "--platform" || remaining.length !== 2) throw new Error("Usage: cocos-web-build menu [--platform <name>]");
            platform = readValue(remaining, 1, "--platform");
        }
        await (await import("../src/cli.mjs")).runCli(platform, projectOptions);
    } else throw new Error(`Unknown command: ${command}`);
}

main().catch(error => {
    if (error?.name === "ExitPromptError") console.log("Cancelled.");
    else { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
});
