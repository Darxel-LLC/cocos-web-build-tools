import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = "https://npm.pkg.github.com";
const dryRun = process.argv.includes("--dry-run");
if (process.argv.slice(2).some(arg => arg !== "--dry-run")) throw new Error("Only --dry-run is supported.");
if (!process.env.npm_execpath) throw new Error("Run this script with npm run publish:packages.");

function npm(args, capture = false) {
    const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
        cwd: root, windowsHide: true, encoding: "utf8",
        stdio: capture ? "pipe" : "inherit",
    });
    if (result.error) throw result.error;
    return result;
}

// Core must exist before consumers can resolve adapters' peer dependency.
for (const directory of ["core", "adapter-yandex", "adapter-vk"]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "packages", directory, "package.json"), "utf8"));
    if (!manifest.name.startsWith("@darxel-llc/") || manifest.publishConfig?.registry !== registry) {
        throw new Error(`Unexpected publication target: ${directory}`);
    }
    const spec = `${manifest.name}@${manifest.version}`;
    if (!dryRun) {
        const existing = npm(["view", spec, "version", "--json", `--registry=${registry}`, "--fetch-retries=0", "--fetch-timeout=30000"], true);
        if (existing.status === 0) {
            if (JSON.parse(existing.stdout) !== manifest.version) throw new Error(`Unexpected registry version for ${spec}`);
            console.log(`${spec} already exists; skipping. Increment the version to publish changes.`);
            continue;
        }
        let errorCode;
        try { errorCode = JSON.parse(existing.stdout).error?.code; } catch { /* Report the original error below. */ }
        if (errorCode !== "E404") throw new Error(`Cannot check ${spec}: ${existing.stderr || existing.stdout}`);
    }
    const result = npm(["publish", "--workspace", manifest.name, ...(dryRun ? ["--dry-run"] : [])]);
    if (result.status !== 0) throw new Error(`Publishing ${spec} failed (${result.status ?? result.signal}).`);
}
