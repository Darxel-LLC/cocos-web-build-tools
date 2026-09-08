const fs = require("node:fs");
const path = require("node:path");
const { createProcessTools } = require("./process.js");

function createPostProcessingTools(context) {
    const { projectRoot: PROJECT_ROOT, resolveProjectPath, resolveBuildRootPath } = context;
    const { runCommand } = createProcessTools(context);
    function processHtmlOverlay(buildPath, options) {
        const htmlOverlay = options.postProcessing.htmlOverlay;
        const indexPath = path.join(buildPath, "index.html");
        if (options.dryRun) {
            const action = htmlOverlay.enabled ? "inject" : "remove";
            if (fs.existsSync(indexPath)) {
                console.log(`Would ${action} HTML overlay in ${indexPath}`);
            } else {
                console.log(`Would ${action} HTML overlay if ${indexPath} exists`);
            }
            return;
        }

        if (!fs.existsSync(indexPath)) {
            throw new Error(`Build index.html not found: ${indexPath}`);
        }

        let html = fs.readFileSync(indexPath, "utf8");
        const strippedHtml = stripHtmlOverlay(html, htmlOverlay);

        if (!htmlOverlay.enabled) {
            if (strippedHtml !== html) {
                fs.writeFileSync(indexPath, strippedHtml, "utf8");
                console.log(`Removed HTML overlay from ${indexPath}`);
            } else {
                console.log("HTML overlay disabled");
            }
            return;
        }

        const templatePath = resolveProjectPath(htmlOverlay.templatePath);
        if (!fs.existsSync(templatePath)) {
            throw new Error(`HTML overlay template not found: ${templatePath}`);
        }

        const template = fs.readFileSync(templatePath, "utf8").trim();
        const block = `\n${(htmlOverlay.markers?.start || "<!-- CWBT_OVERLAY_START -->")}\n${template}\n${(htmlOverlay.markers?.end || "<!-- CWBT_OVERLAY_END -->")}\n`;
        const bodyOpenMatch = strippedHtml.match(/<body\b[^>]*>/i);
        if (!bodyOpenMatch || bodyOpenMatch.index === undefined) {
            throw new Error(`Cannot inject HTML overlay: <body> not found in ${indexPath}`);
        }

        const insertIndex = bodyOpenMatch.index + bodyOpenMatch[0].length;
        html = `${strippedHtml.slice(0, insertIndex)}${block}${strippedHtml.slice(insertIndex)}`;
        fs.writeFileSync(indexPath, html, "utf8");
        console.log(`Injected HTML overlay into ${indexPath}`);
    }

    function stripHtmlOverlay(html, htmlOverlay) {
        const start = escapeRegExp((htmlOverlay.markers?.start || "<!-- CWBT_OVERLAY_START -->"));
        const end = escapeRegExp((htmlOverlay.markers?.end || "<!-- CWBT_OVERLAY_END -->"));
        return html.replace(new RegExp(`${start}[\\s\\S]*?${end}\\s*`, "g"), "");
    }

    function escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function obfuscateMainBundle(buildPath, options) {
        const scriptObfuscation = options.postProcessing.scriptObfuscation;
        const mainBundlePath = context.resolveInside(buildPath, scriptObfuscation.inputPath || "assets/main");
        if (!fs.existsSync(mainBundlePath)) {
            if (options.dryRun) {
                console.log(`Would obfuscate ${mainBundlePath} if it exists`);
                return;
            }
            throw new Error(`Obfuscation input not found: ${mainBundlePath}`);
        }

        const obfuscatorPath = resolveObfuscatorPath();
        if (!options.dryRun && !fs.existsSync(obfuscatorPath)) {
            throw new Error(`javascript-obfuscator is not installed. Run npm install in ${PROJECT_ROOT}.`);
        }

        runCommand(process.execPath, [
            obfuscatorPath,
            mainBundlePath,
            "--output",
            mainBundlePath,
            "--config",
            resolveProjectPath(scriptObfuscation.configPath),
        ], {
            dryRun: options.dryRun,
            cwd: PROJECT_ROOT,
        });
    }

    function resolveObfuscatorPath() {
        return require.resolve("javascript-obfuscator/bin/javascript-obfuscator");
    }

    function zipBuild(buildPath, version, options) {
        const zip = options.postProcessing.zip;
        const sevenZipPath = resolveProjectPath(zip.toolPath);
        if (!options.dryRun && !fs.existsSync(sevenZipPath)) {
            throw new Error(`7-Zip executable not found: ${sevenZipPath}`);
        }

        const zipPath = resolveZipPath(version, options);
        if (fs.existsSync(zipPath)) {
            if (options.dryRun) {
                console.log(`Would remove existing archive: ${zipPath}`);
            } else {
                console.log(`Removing existing archive: ${zipPath}`);
                fs.rmSync(zipPath, { force: true });
            }
        }

        runCommand(sevenZipPath, [
            "a",
            "-tzip",
            `-mx${zip.compressionLevel}`,
            zipPath,
            path.join(buildPath, "*"),
        ], {
            dryRun: options.dryRun,
            cwd: PROJECT_ROOT,
        });
    }

    function resolveZipPath(version, options) {
        return resolveBuildRootPath(`${options.postProcessing.zip.archiveName}-${version}.zip`);
    }
    return { processHtmlOverlay, obfuscateMainBundle, zipBuild, resolveZipPath };
}

module.exports = { createPostProcessingTools };
