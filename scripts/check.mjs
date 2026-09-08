import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function check(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules") check(filename);
        else if (/\.(?:c?js|mjs)$/.test(entry.name)) {
            const result = spawnSync(process.execPath, ["--check", filename], { stdio: "inherit", windowsHide: true });
            if (result.error) throw result.error;
            if (result.status !== 0) process.exit(result.status || 1);
        }
    }
}
for (const directory of ["packages", "scripts"]) {
    if (fs.existsSync(path.join(root, directory))) check(path.join(root, directory));
}
console.log("JavaScript syntax checks passed.");
