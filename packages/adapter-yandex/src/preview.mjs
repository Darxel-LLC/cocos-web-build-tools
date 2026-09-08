import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function proxyInvocation(buildPath, port) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Preview port must be an integer from 1 to 65535.");
    const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")];
    const npmCli = candidates.find(value => value && path.basename(value) === "npm-cli.js" && fs.existsSync(value));
    if (!npmCli) throw new Error("Cannot find npm CLI. Start preview through an npm script or use a Node installation that includes npm.");
    return {
        command: process.execPath,
        // The published proxy's preinstall only enforces pnpm; its CLI is already
        // compiled. Disable install scripts for this npm exec, not for the game.
        args: [npmCli, "exec", "--yes", "--prefer-offline", "--ignore-scripts", "--package=@yandex-games/sdk-dev-proxy@0.0.2", "--", "sdk-dev-proxy", "-p", buildPath, "--csp", "--port", String(port)],
    };
}

export async function startYandexProxy({ projectRoot, buildPath, port = 12333, target }) {
    if (target.platform !== "yandex" || target.sdkMode !== "real") throw new Error("Yandex preview requires a real Yandex build.");
    const invocation = proxyInvocation(buildPath, port);
    console.log(`Starting Yandex SDK proxy for ${buildPath} on port ${port}. Press Ctrl+C to stop.`);
    const child = spawn(invocation.command, invocation.args, {
        cwd: projectRoot, stdio: "inherit", windowsHide: true,
        detached: process.platform !== "win32",
    });
    let closing = false;
    const finished = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
            if (closing || code === 0 || signal === "SIGINT") resolve();
            else reject(new Error(`Yandex SDK proxy failed: ${signal || code}`));
        });
    });
    // Callers can await finished; attach a handler while spawn itself is pending.
    finished.catch(() => {});
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    return {
        finished,
        async close() {
            closing = true;
            if (child.exitCode === null && child.signalCode === null) {
                if (process.platform === "win32") {
                    // npm owns the proxy child. Stop this owned tree, not just npm.
                    await new Promise((resolve, reject) => execFile("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true }, error => {
                        if (error && child.exitCode === null && child.signalCode === null) reject(error);
                        else resolve();
                    }));
                } else {
                    try { process.kill(-child.pid, "SIGTERM"); }
                    catch (error) { if (error.code !== "ESRCH") throw error; }
                }
            }
            await finished;
        },
    };
}
