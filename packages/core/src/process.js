const { spawn, spawnSync } = require("node:child_process");

function createProcessTools(context) {
    const PROJECT_ROOT = context.projectRoot;
    function runCommand(command, args, options = {}) {
        const dryRun = Boolean(options.dryRun);
        const cwd = options.cwd ?? PROJECT_ROOT;
        const shell = Boolean(options.shell);

        if (options.logCommand !== false) {
            console.log(formatCommand(command, args));
        }

        if (dryRun) {
            return;
        }

        const result = spawnSync(command, args, {
            cwd,
            shell,
            stdio: "inherit",
            windowsHide: true,
        });

        if (result.error) {
            throw result.error;
        }

        if (result.status !== 0) {
            throw new Error(`Command failed with exit code ${result.status}: ${formatCommand(command, args)}`);
        }
    }

    function runCommandAsync(command, args, options = {}) {
        const dryRun = Boolean(options.dryRun);
        const cwd = options.cwd ?? PROJECT_ROOT;
        const shell = Boolean(options.shell);

        if (options.logCommand !== false) {
            console.log(formatCommand(command, args));
        }

        if (dryRun) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                cwd,
                shell,
                stdio: "inherit",
                windowsHide: true,
            });

            child.once("error", reject);
            child.once("exit", (code, signal) => {
                if (code === 0) {
                    resolve();
                    return;
                }

                const exitReason = signal ? `signal ${signal}` : `exit code ${code}`;
                reject(new Error(`Command failed with ${exitReason}: ${formatCommand(command, args)}`));
            });
        });
    }

    function formatCommand(command, args) {
        return [command, ...args].map(quoteArg).join(" ");
    }

    function quoteArg(value) {
        const text = String(value);
        if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) {
            return text;
        }
        return `"${text.replace(/"/g, '\\"')}"`;
    }
    return { runCommand, runCommandAsync, formatCommand };
}

module.exports = { createProcessTools };
