const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile, execFileSync } = require("node:child_process");
const { createAssetOverrides } = require("./cocos/asset-overrides.js");
const { createProcessTools } = require("./process.js");

function createImageTools(context) {
    const { projectRoot: PROJECT_ROOT, resolveProjectPath } = context;
    const { runCommand, runCommandAsync, formatCommand } = createProcessTools(context);
    const { readImageCompressionOverrides } = createAssetOverrides(context);
    function collectImageFiles(rootPath) {
        if (!fs.existsSync(rootPath)) {
            return [];
        }

        const files = [];
        const entries = fs.readdirSync(rootPath, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(rootPath, entry.name);
            if (entry.isDirectory()) {
                files.push(...collectImageFiles(entryPath));
            } else if (entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name)) {
                files.push(entryPath);
            }
        }
        return files;
    }

    function findImageCompressionOverride(imagePath, overridesByUuid, overridesByPackedUuid) {
        const fileStem = path.basename(imagePath, path.extname(imagePath)).toLowerCase();
        const assetUuid = extractLeadingUuid(fileStem);
        if (assetUuid) {
            return overridesByUuid.get(assetUuid) ?? null;
        }
        // Packed atlas textures (e.g. from .pac auto-atlases) use short, non-hyphenated UUIDs and may carry a release
        // hash suffix (e.g. "1e6efb2f4.ec51c"). Strip everything after the first dot before looking the stem up.
        const baseStem = fileStem.split(".")[0];
        return overridesByPackedUuid.get(baseStem) ?? overridesByUuid.get(baseStem) ?? null;
    }

    function extractLeadingUuid(fileStem) {
        const match = fileStem.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[.@]|$)/);
        return match ? match[1] : null;
    }
    function createImageCompressionSummary() {
        return {
            enabled: true,
            dryRun: false,
            totalImages: 0,
            skippedByOverride: 0,
            losslessByOverride: 0,
            unmatchedOverrides: 0,
            tools: new Map(),
            adaptiveJpeg: createAdaptiveCompressionSummary(),
        };
    }

    function createAdaptiveCompressionSummary() {
        return {
            attempts: 0,
            selectedQualities: new Map(),
            originalFallbacks: 0,
            evaluationErrors: 0,
        };
    }

    function createSkippedImageCompressionSummary(reason) {
        return {
            enabled: false,
            reason,
            dryRun: false,
            totalImages: 0,
            skippedByOverride: 0,
            losslessByOverride: 0,
            unmatchedOverrides: 0,
            tools: new Map(),
        };
    }

    function getImageCompressionToolSummary(summary, toolPath) {
        const toolName = path.basename(toolPath);
        let toolSummary = summary.tools.get(toolName);
        if (!toolSummary) {
            toolSummary = {
                toolName,
                planned: 0,
                processed: 0,
                beforeBytes: 0,
                afterBytes: 0,
                savedBytes: 0,
            };
            summary.tools.set(toolName, toolSummary);
        }
        return toolSummary;
    }

    function recordImageCompression(toolSummary, beforeBytes, afterBytes, dryRun) {
        toolSummary.beforeBytes += beforeBytes;

        if (dryRun) {
            toolSummary.planned++;
            return;
        }

        toolSummary.processed++;
        toolSummary.afterBytes += afterBytes;
        toolSummary.savedBytes += beforeBytes - afterBytes;
    }

    function printImageCompressionSummary(summary) {
        if (!summary.enabled) {
            console.log(`Image compression summary: skipped (${summary.reason})`);
            return;
        }

        console.log("Image compression summary:");
        console.log(`  PNG/JPG files found: ${summary.totalImages}`);

        if (summary.skippedByOverride > 0) {
            console.log(`  Skipped by override: ${summary.skippedByOverride}`);
        }
        if (summary.losslessByOverride > 0) {
            console.log(`  Lossless by override: ${summary.losslessByOverride}`);
        }
        if (summary.unmatchedOverrides > 0) {
            console.log(`  Overrides not found in build: ${summary.unmatchedOverrides}`);
        }

        if (summary.tools.size === 0) {
            console.log("  No image compression tools were run");
            return;
        }

        for (const toolSummary of summary.tools.values()) {
            if (summary.dryRun) {
                console.log(`  ${toolSummary.toolName}: would process ${toolSummary.planned} files (${formatBytes(toolSummary.beforeBytes)} input)`);
                continue;
            }

            console.log(`  ${toolSummary.toolName}: processed ${toolSummary.processed} files, ${formatBytes(toolSummary.beforeBytes)} -> ${formatBytes(toolSummary.afterBytes)}, saved ${formatSignedBytes(toolSummary.savedBytes)} (${formatSavingsPercent(toolSummary.savedBytes, toolSummary.beforeBytes)})`);
        }

        if (!summary.dryRun) {
            printAdaptiveCompressionSummary("JPEG", summary.adaptiveJpeg);
        }
    }

    function printAdaptiveCompressionSummary(format, adaptiveSummary) {
        if (adaptiveSummary.attempts === 0) {
            return;
        }

        const selections = [...adaptiveSummary.selectedQualities.entries()]
            .sort(([qualityA], [qualityB]) => qualityA - qualityB)
            .map(([quality, count]) => `q${quality}: ${count}`);
        console.log(`  Adaptive ${format}: ${adaptiveSummary.attempts} evaluations; selected ${selections.join(", ") || "none"}; original fallback: ${adaptiveSummary.originalFallbacks}; evaluation errors: ${adaptiveSummary.evaluationErrors}`);
    }

    function formatBytes(bytes) {
        const units = ["B", "KB", "MB", "GB"];
        let value = bytes;
        let unitIndex = 0;

        while (Math.abs(value) >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex++;
        }

        const fractionDigits = unitIndex === 0 ? 0 : 2;
        return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
    }

    function formatSignedBytes(bytes) {
        if (bytes < 0) {
            return `-${formatBytes(Math.abs(bytes))}`;
        }

        return formatBytes(bytes);
    }

    function formatSavingsPercent(savedBytes, beforeBytes) {
        if (beforeBytes === 0) {
            return "0.0%";
        }

        return `${((savedBytes / beforeBytes) * 100).toFixed(1)}%`;
    }
    function getCaesiumFeatures(caesiumPath, options) {
        if (!fs.existsSync(caesiumPath)) {
            return {
                minSavings: false,
            };
        }

        let help;
        try {
            help = execFileSync(caesiumPath, ["--help"], {
                cwd: PROJECT_ROOT,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            });
        } catch (error) {
            if (!options.dryRun) {
                console.warn(`Could not inspect caesiumclt options: ${error.message}`);
            }
            help = "";
        }

        return {
            minSavings: help.includes("--min-savings"),
            threads: help.includes("--threads"),
        };
    }

    function createCaesiumArgs(imagePath, imageCompression, features, overrides = {}) {
        const extension = path.extname(imagePath).toLowerCase();
        const isPng = extension === ".png";
        const args = [
            "--overwrite",
            overrides.overwritePolicy ?? imageCompression.overwritePolicy,
            "--quiet",
        ];

        const quality = overrides.quality ?? (isPng
            ? imageCompression.png.quality
            : imageCompression.jpg.qualitySteps[0]);
        args.push("--quality", String(quality));

        if (features.threads && overrides.threads !== undefined) {
            args.push("--threads", String(overrides.threads));
        }

        if (isPng) {
            args.push("--png-opt-level", String(imageCompression.png.optimizationLevel));
        }

        if (features.minSavings && overrides.includeMinSavings !== false) {
            args.push("--min-savings", imageCompression.minSavings);
        }

        args.push(
            "--output",
            overrides.outputDirectory ?? path.dirname(imagePath),
            imagePath,
        );

        return args;
    }

    function createPngBatchArgs(imagePaths, imageCompression, features, pngThreads) {
        const args = [
            "--overwrite",
            imageCompression.overwritePolicy,
            "--quiet",
            "--quality",
            String(imageCompression.png.quality),
            "--png-opt-level",
            String(imageCompression.png.optimizationLevel),
        ];

        if (features.threads) {
            args.push("--threads", String(pngThreads));
        }

        if (features.minSavings) {
            args.push("--min-savings", imageCompression.minSavings);
        }

        args.push("--same-folder-as-input", ...imagePaths);
        return args;
    }

    function createLosslessBatchArgs(imagePaths, imageCompression, features, threads) {
        const args = [
            "--overwrite",
            imageCompression.overwritePolicy,
            "--quiet",
            "--lossless",
            "--png-opt-level",
            String(imageCompression.png.optimizationLevel),
        ];

        if (features.threads) {
            args.push("--threads", String(threads));
        }

        if (features.minSavings) {
            args.push("--min-savings", imageCompression.minSavings);
        }

        args.push("--same-folder-as-input", ...imagePaths);
        return args;
    }

    function splitPathsIntoCommandBatches(command, baseArgs, paths) {
        const maxCommandLength = process.platform === "win32" ? 28000 : 100000;
        const batches = [];
        let currentBatch = [];

        for (const imagePath of paths) {
            const candidateBatch = [...currentBatch, imagePath];
            if (currentBatch.length > 0 && formatCommand(command, [...baseArgs, ...candidateBatch]).length > maxCommandLength) {
                batches.push(currentBatch);
                currentBatch = [imagePath];
            } else {
                currentBatch = candidateBatch;
            }
        }

        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }

        return batches;
    }

    function getAvailableParallelism() {
        const detected = typeof os.availableParallelism === "function"
            ? os.availableParallelism()
            : os.cpus().length;
        return Number.isInteger(detected) && detected > 0 ? detected : 1;
    }

    function resolveImageConcurrency(configuredConcurrency, imageCount, availableParallelism) {
        if (imageCount === 0) {
            return 0;
        }
        const desired = configuredConcurrency > 0
            ? configuredConcurrency
            : Math.max(1, Math.ceil(availableParallelism / 2));
        return Math.max(1, Math.min(imageCount, desired, availableParallelism));
    }

    function resolvePngThreads(configuredThreads, availableParallelism) {
        return configuredThreads === 0
            ? 0
            : Math.min(configuredThreads, availableParallelism);
    }

    function formatAdaptiveCompressionStages(formatConfig) {
        return formatConfig.qualitySteps.join(" -> ");
    }

    async function runWithConcurrency(items, concurrency, handler) {
        let nextIndex = 0;
        let firstError = null;

        async function worker() {
            while (!firstError) {
                const currentIndex = nextIndex++;
                if (currentIndex >= items.length) {
                    return;
                }

                try {
                    await handler(items[currentIndex], currentIndex);
                } catch (error) {
                    firstError ??= error;
                }
            }
        }

        const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
        await Promise.all(workers);
        if (firstError) {
            throw firstError;
        }
    }

    function hasRequiredSavings(beforeBytes, afterBytes, minSavings) {
        if (beforeBytes === 0) {
            return false;
        }

        const requiredPercent = Number.parseFloat(minSavings.slice(0, -1));
        const actualPercent = ((beforeBytes - afterBytes) / beforeBytes) * 100;
        return actualPercent >= requiredPercent;
    }

    function evaluateSsimulacra2(ssimulacra2Path, sourcePath, distortedPath) {
        return new Promise((resolve, reject) => {
            execFile(ssimulacra2Path, ["image", sourcePath, distortedPath], {
                cwd: PROJECT_ROOT,
                encoding: "utf8",
                windowsHide: true,
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ""}`));
                    return;
                }

                const match = stdout.match(/Score:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))/i);
                const score = match ? Number.parseFloat(match[1]) : Number.NaN;
                if (!Number.isFinite(score)) {
                    reject(new Error(`Unexpected SSIMULACRA2 output: ${stdout.trim() || "<empty>"}`));
                    return;
                }
                resolve(score);
            });
        });
    }

    function recordAdaptiveImageSelection(adaptiveSummary, quality) {
        const currentCount = adaptiveSummary.selectedQualities.get(quality) ?? 0;
        adaptiveSummary.selectedQualities.set(quality, currentCount + 1);
    }

    async function compressImageAdaptively(
        imagePath,
        imageCompression,
        formatConfig,
        adaptiveSummary,
        formatName,
        caesiumPath,
        caesiumFeatures,
        ssimulacra2Path,
        tempRoot,
        imageIndex,
    ) {
        const originalBytes = fs.statSync(imagePath).size;
        const fileName = path.basename(imagePath);
        for (const quality of formatConfig.qualitySteps) {
            const label = `q${quality}`;
            const candidateDirectory = path.join(tempRoot, `image-${imageIndex}`, label);
            fs.mkdirSync(candidateDirectory, { recursive: true });
            await runCommandAsync(caesiumPath, createCaesiumArgs(imagePath, imageCompression, caesiumFeatures, {
                quality,
                outputDirectory: candidateDirectory,
                overwritePolicy: "all",
                includeMinSavings: false,
                threads: 1,
            }), { cwd: PROJECT_ROOT, logCommand: false });

            const candidatePath = path.join(candidateDirectory, fileName);
            if (!fs.existsSync(candidatePath)) {
                throw new Error(`${formatName} compressor did not create candidate: ${candidatePath}`);
            }

            adaptiveSummary.attempts++;
            let score;
            try {
                score = await evaluateSsimulacra2(ssimulacra2Path, imagePath, candidatePath);
            } catch (error) {
                adaptiveSummary.evaluationErrors++;
                adaptiveSummary.originalFallbacks++;
                console.warn(`${fileName}: SSIMULACRA2 evaluation failed; keeping original. ${error.message}`);
                return originalBytes;
            }

            const candidateBytes = fs.statSync(candidatePath).size;
            const scoreText = score.toFixed(2);
            if (score < formatConfig.minSsimulacra2Score) {
                console.log(`${fileName}: ${label} scored ${scoreText}; retrying with gentler compression`);
                continue;
            }

            if (!hasRequiredSavings(originalBytes, candidateBytes, imageCompression.minSavings)) {
                adaptiveSummary.originalFallbacks++;
                console.log(`${fileName}: ${label} scored ${scoreText}, but saved less than ${imageCompression.minSavings}; keeping original`);
                return originalBytes;
            }

            fs.copyFileSync(candidatePath, imagePath);
            recordAdaptiveImageSelection(adaptiveSummary, quality);
            console.log(`${fileName}: selected ${label}, SSIMULACRA2 ${scoreText}, ${formatBytes(originalBytes)} -> ${formatBytes(candidateBytes)}`);
            return candidateBytes;
        }

        adaptiveSummary.originalFallbacks++;
        console.log(`${fileName}: no ${formatName} compression stage reached SSIMULACRA2 ${formatConfig.minSsimulacra2Score}; keeping original`);
        return originalBytes;
    }

    async function compressImages(buildPath, options) {
        const imageCompression = options.postProcessing.imageCompression;
        const overrides = readImageCompressionOverrides(imageCompression.overridesPath);
        const images = collectImageFiles(buildPath);
        const summary = createImageCompressionSummary();
        summary.dryRun = options.dryRun;
        summary.totalImages = images.length;

        if (images.length === 0) {
            if (options.dryRun && !fs.existsSync(buildPath)) {
                console.log(`Would compress PNG/JPG files under ${buildPath}`);
            } else {
                console.log(`No PNG/JPG files found under ${buildPath}`);
            }
            return summary;
        }

        const caesiumPath = resolveProjectPath(imageCompression.toolPath);
        if (!options.dryRun && !fs.existsSync(caesiumPath)) {
            throw new Error(`Image compressor not found: ${caesiumPath}`);
        }

        const caesiumFeatures = getCaesiumFeatures(caesiumPath, options);
        const caesiumSummary = getImageCompressionToolSummary(summary, caesiumPath);
        const imageTasks = [];
        const losslessTasks = [];
        for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
            const imagePath = images[imageIndex];
            const task = {
                imagePath,
                imageIndex,
                beforeBytes: fs.statSync(imagePath).size,
            };
            const override = findImageCompressionOverride(imagePath, overrides.byUuid, overrides.byPackedUuid);
            if (!override) {
                imageTasks.push(task);
                continue;
            }

            override.matches++;
            if (override.processing === "skip") {
                summary.skippedByOverride++;
                console.log(`${path.basename(imagePath)}: skipped by override ${override.label} — ${override.reason}`);
                continue;
            }

            summary.losslessByOverride++;
            task.override = override;
            losslessTasks.push(task);
        }

        for (const override of overrides.entries.filter((entry) => entry.matches === 0)) {
            summary.unmatchedOverrides++;
            console.warn(`Image compression override did not match a build image: ${override.label}`);
        }

        const pngTasks = imageTasks.filter((task) => path.extname(task.imagePath).toLowerCase() === ".png");
        const jpegTasks = imageTasks.filter((task) => /\.jpe?g$/i.test(task.imagePath));
        const ssimulacra2Path = resolveProjectPath(imageCompression.ssimulacra2ToolPath);
        if (!options.dryRun && jpegTasks.length > 0 && !fs.existsSync(ssimulacra2Path)) {
            throw new Error(`SSIMULACRA2 executable not found: ${ssimulacra2Path}`);
        }

        const availableParallelism = getAvailableParallelism();
        const pngThreads = resolvePngThreads(imageCompression.parallelism.pngThreads, availableParallelism);
        const jpegConcurrency = resolveImageConcurrency(
            imageCompression.parallelism.jpegConcurrency,
            jpegTasks.length,
            availableParallelism,
        );
        const pngThreadLabel = pngThreads === 0 ? `auto (up to ${availableParallelism})` : String(pngThreads);
        console.log(`Image compression parallelism: ${availableParallelism} logical CPUs available; PNG threads: ${pngThreadLabel}; JPEG workers: ${jpegConcurrency}`);

        const losslessBaseArgs = createLosslessBatchArgs([], imageCompression, caesiumFeatures, pngThreads);
        const losslessBatches = splitPathsIntoCommandBatches(
            caesiumPath,
            losslessBaseArgs,
            losslessTasks.map((task) => task.imagePath),
        );
        const pngBaseArgs = createPngBatchArgs([], imageCompression, caesiumFeatures, pngThreads);
        const pngBatches = splitPathsIntoCommandBatches(
            caesiumPath,
            pngBaseArgs,
            pngTasks.map((task) => task.imagePath),
        );

        if (options.dryRun) {
            if (losslessTasks.length > 0) {
                console.log(`Would losslessly compress ${losslessTasks.length} override image(s) in ${losslessBatches.length} Caesium batch(es)`);
            }
            if (pngTasks.length > 0) {
                console.log(`Would compress ${pngTasks.length} PNG files at q${imageCompression.png.quality} in ${pngBatches.length} multithreaded Caesium batch(es)`);
            }
            if (jpegTasks.length > 0) {
                console.log(`Would adaptively compress ${jpegTasks.length} JPEG files with ${jpegConcurrency} worker(s) through ${formatAdaptiveCompressionStages(imageCompression.jpg)}, requiring SSIMULACRA2 >= ${imageCompression.jpg.minSsimulacra2Score}, then fall back to the original`);
            }
            for (const task of [...losslessTasks, ...imageTasks]) {
                recordImageCompression(caesiumSummary, task.beforeBytes, task.beforeBytes, true);
            }
            return summary;
        }

        const losslessTasksByPath = new Map(losslessTasks.map((task) => [task.imagePath, task]));
        for (let batchIndex = 0; batchIndex < losslessBatches.length; batchIndex++) {
            const batch = losslessBatches[batchIndex];
            console.log(`Compressing lossless override batch ${batchIndex + 1}/${losslessBatches.length} (${batch.length} files)`);
            runCommand(
                caesiumPath,
                createLosslessBatchArgs(batch, imageCompression, caesiumFeatures, pngThreads),
                { cwd: PROJECT_ROOT, logCommand: false },
            );
            for (const imagePath of batch) {
                const task = losslessTasksByPath.get(imagePath);
                const afterBytes = fs.statSync(imagePath).size;
                recordImageCompression(caesiumSummary, task.beforeBytes, afterBytes, false);
                if (afterBytes < task.beforeBytes) {
                    console.log(`${path.basename(imagePath)}: lossless ${formatBytes(task.beforeBytes)} -> ${formatBytes(afterBytes)} (${task.override.label})`);
                } else {
                    console.log(`${path.basename(imagePath)}: lossless produced no required savings; keeping original (${task.override.label})`);
                }
            }
        }

        const pngTasksByPath = new Map(pngTasks.map((task) => [task.imagePath, task]));
        for (let batchIndex = 0; batchIndex < pngBatches.length; batchIndex++) {
            const batch = pngBatches[batchIndex];
            console.log(`Compressing PNG batch ${batchIndex + 1}/${pngBatches.length} (${batch.length} files)`);
            runCommand(
                caesiumPath,
                createPngBatchArgs(batch, imageCompression, caesiumFeatures, pngThreads),
                { cwd: PROJECT_ROOT, logCommand: false },
            );
            for (const imagePath of batch) {
                const task = pngTasksByPath.get(imagePath);
                recordImageCompression(caesiumSummary, task.beforeBytes, fs.statSync(imagePath).size, false);
            }
        }

        const tempRoot = jpegTasks.length > 0
            ? fs.mkdtempSync(path.join(os.tmpdir(), "cwbt-jpeg-compression-"))
            : null;

        try {
            await runWithConcurrency(jpegTasks, jpegConcurrency, async (task) => {
                const afterBytes = await compressImageAdaptively(
                    task.imagePath,
                    imageCompression,
                    imageCompression.jpg,
                    summary.adaptiveJpeg,
                    "JPEG",
                    caesiumPath,
                    caesiumFeatures,
                    ssimulacra2Path,
                    tempRoot,
                    task.imageIndex,
                );
                recordImageCompression(caesiumSummary, task.beforeBytes, afterBytes, false);
            });
        } finally {
            if (tempRoot) {
                if (path.dirname(tempRoot) !== os.tmpdir() || !path.basename(tempRoot).startsWith("cwbt-jpeg-compression-")) {
                    throw new Error(`Refusing to clean unexpected compression directory: ${tempRoot}`);
                }
                fs.rmSync(tempRoot, { recursive: true, force: true });
            }
        }

        return summary;
    }
    return { compressImages, createSkippedImageCompressionSummary, printImageCompressionSummary };
}

module.exports = { createImageTools };
