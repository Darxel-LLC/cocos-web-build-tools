const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { runBuild, loadProject } = require("../src/index.js");
const { definePlatform, local, createPlatformTools } = require("../src/platforms.js");
const { getPlatformActions, previewBuild, deployBuild } = require("../src/actions.js");

function fixture(t) {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cwbt-test-"));
    t.after(() => {
        assert.equal(path.dirname(projectRoot), fs.realpathSync(os.tmpdir()));
        fs.rmSync(projectRoot, { recursive: true, force: true });
    });
    fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "independent-game", version: "2.3.4" }));
    const output = path.join(projectRoot, "build", "web");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "index.html"), "<!doctype html><html><body>Another game</body></html>");
    return {
        projectRoot, output,
        config: { configs: { dev: { buildOptions: { platform: "web-mobile" }, buildOutputName: "web" } } },
    };
}

test("processes an unrelated project without runtime, templates or post-processing config", async t => {
    const f = fixture(t);
    const events = [];
    f.config.hooks = Object.fromEntries(["beforeBuild", "preparePlatform", "afterProcess"].map(name => [name, ({ projectRoot, dryRun }) => {
        assert.equal(projectRoot, f.projectRoot);
        assert.equal(dryRun, false);
        events.push(name);
    }]));
    const result = await runBuild(["dev", "--skip-build"], f);
    assert.equal(result.version, "2.3.4");
    assert.deepEqual(events, ["beforeBuild", "preparePlatform", "afterProcess"]);
    assert.equal(fs.readFileSync(path.join(f.output, "index.html"), "utf8").includes("Another game"), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.output, "platform-target.json"))), { platform: "local", mode: "dev", sdkMode: "real" });
});

test("local stays the default when another adapter is installed and registered", async t => {
    const f = fixture(t);
    f.config.platforms = [definePlatform({ id: "custom", label: "Custom" })];
    const result = await runBuild(["dev", "--skip-build"], f);
    assert.equal(result.target.platform, "local");
    const builtIn = createPlatformTools({ projectRoot: f.projectRoot });
    assert.deepEqual(Object.keys(builtIn.platformDefinitions), ["local"]);
    assert.throws(() => builtIn.getPlatformDefinition("uninstalled"), /Install and register/);
    const overrides = createPlatformTools({ projectRoot: f.projectRoot, platforms: [local({ defaultSdkMode: { dev: "mock" } })] });
    assert.equal(overrides.resolvePlatformTarget("local", "dev").sdkMode, "mock");
});

test("adapter registration rejects duplicates and incompatible contracts", t => {
    const f = fixture(t);
    const adapter = definePlatform({ id: "custom", label: "Custom" });
    assert.throws(() => createPlatformTools({ projectRoot: f.projectRoot, platforms: [adapter, adapter] }), /Duplicate/);
    assert.throws(() => createPlatformTools({ projectRoot: f.projectRoot, platforms: [{ ...adapter, apiVersion: 2 }] }), /API version/);
    assert.throws(() => definePlatform({ id: "custom", label: "Custom", preview: "hardcoded-transport" }), /must be a function/);
});

test("adapters require a string id before registration or build changes", async t => {
    const f = fixture(t);
    for (const id of [undefined, null, true, 1, Symbol("custom"), ["custom"], { toString: () => "custom" }]) {
        const definition = { id, label: "Invalid adapter", apiVersion: 1 };
        assert.throws(() => definePlatform(definition), /[Pp]latform id/);
        assert.throws(() => createPlatformTools({ projectRoot: f.projectRoot, platforms: [definition] }), /[Pp]latform id/);
    }
    f.config.platforms = [{ label: "Missing id", apiVersion: 1 }];
    let hookCalled = false;
    f.config.hooks = { beforeBuild() { hookCalled = true; } };
    await assert.rejects(runBuild(["dev", "--skip-build"], f), /[Pp]latform id/);
    assert.equal(hookCalled, false);
    assert.deepEqual(fs.readdirSync(f.output), ["index.html"]);
});

test("custom adapter lifecycle is awaited in order and receives dry-run", async t => {
    const f = fixture(t);
    const events = [];
    const stage = name => async ctx => { assert.equal(ctx.dryRun, true); await Promise.resolve(); events.push(name); };
    f.config.platforms = [definePlatform({
        id: "custom", label: "Custom",
        resolveTarget: () => ({ sdkMode: "sandbox" }),
        validate: stage("validate"), prepareBuild: stage("prepare"), processBuild: stage("process"),
    })];
    f.config.hooks = { beforeBuild: stage("before"), preparePlatform: stage("project"), afterProcess: stage("after") };
    const result = await runBuild(["dev", "--platform", "custom", "--skip-build", "--dry-run"], f);
    assert.deepEqual(events, ["validate", "before", "prepare", "process", "project", "after"]);
    assert.equal(result.target.sdkMode, "sandbox");
    assert.deepEqual(fs.readdirSync(f.output), ["index.html"]);
});

test("custom preview and deploy are dispatched through capabilities", async t => {
    const f = fixture(t);
    const calls = [];
    const adapter = definePlatform({ id: "custom", label: "Custom",
        preview: async ctx => { calls.push(`preview:${ctx.target.platform}`); return { close() { calls.push("closed"); } }; },
        deploy: async ctx => { calls.push(`deploy:${ctx.target.platform}`); return "fake-upload"; },
    });
    f.config.platforms = [adapter];
    assert.deepEqual(getPlatformActions(definePlatform({ id: "build-only", label: "Build" })).map(a => a.value), ["build-only"]);
    assert.equal(getPlatformActions(adapter).length, 5);
    await runBuild(["dev", "--platform", "custom", "--skip-build"], f);
    const ctx = loadProject(f);
    const handle = await previewBuild(ctx, { configName: "dev", platform: "custom" });
    await handle.close();
    assert.equal(await deployBuild(ctx, { configName: "dev", platform: "custom" }), "fake-upload");
    assert.deepEqual(calls, ["preview:custom", "closed", "deploy:custom"]);
    const targetPath = path.join(f.output, "platform-target.json");
    fs.writeFileSync(targetPath, JSON.stringify({ platform: "different", mode: "dev", sdkMode: "real" }));
    await assert.rejects(deployBuild(ctx, { configName: "dev", platform: "custom" }), /does not match/);
});

test("failed post-processing invalidates an old target manifest", async t => {
    const f = fixture(t);
    await runBuild(["dev", "--skip-build"], f);
    f.config.platforms = [definePlatform({ id: "broken", label: "Broken", processBuild() { throw new Error("adapter failed"); } })];
    await assert.rejects(runBuild(["dev", "--platform", "broken", "--skip-build"], f), /adapter failed/);
    assert.equal(fs.existsSync(path.join(f.output, "platform-target.json")), false);
});

test("dry-run leaves existing output untouched and passes dryRun to hooks", async t => {
    const f = fixture(t);
    const before = fs.readFileSync(path.join(f.output, "index.html"));
    let hookCalled = false;
    f.config.hooks = { beforeBuild: ({ dryRun }) => { assert.equal(dryRun, true); hookCalled = true; } };
    await runBuild(["dev", "--skip-build", "--dry-run"], f);
    assert.ok(hookCalled);
    assert.deepEqual(fs.readFileSync(path.join(f.output, "index.html")), before);
    assert.deepEqual(fs.readdirSync(f.output), ["index.html"]);
});

test("rejects output traversal and junctions before hooks or cleanup", async t => {
    const f = fixture(t);
    f.config.configs.dev.buildOutputName = "../outside";
    await assert.rejects(runBuild(["dev", "--skip-build"], f), /outside root/);
    const external = path.join(f.projectRoot, "external");
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, "keep.txt"), "keep");
    fs.symlinkSync(external, path.join(f.projectRoot, "build", "linked"), "junction");
    f.config.configs.dev.buildOutputName = "linked";
    await assert.rejects(runBuild(["dev"], f), /linked output/);
    assert.equal(fs.readFileSync(path.join(external, "keep.txt"), "utf8"), "keep");
});

test("rejects invalid SDK targets and supports named configs with explicit mode", async t => {
    const f = fixture(t);
    f.config.configs.production = { ...f.config.configs.dev, mode: "release" };
    await assert.rejects(runBuild(["production", "--skip-build", "--sdk-mode", "mock"], f), /Mock services/);
    await assert.rejects(runBuild(["dev", "--platform", "missing", "--skip-build"], f), /Unsupported platform/);
    const result = await runBuild(["production", "--skip-build"], f);
    assert.equal(result.target.mode, "release");
});

test("HTML overlay is idempotent and removed for release", async t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.projectRoot, "overlay.html"), '<div id="qa">QA</div>');
    f.config.configs.dev.postProcessing = { htmlOverlay: { enabled: true, templatePath: "overlay.html" } };
    await runBuild(["dev", "--skip-build"], f);
    await runBuild(["dev", "--skip-build"], f);
    assert.equal(fs.readFileSync(path.join(f.output, "index.html"), "utf8").split('id="qa"').length, 2);
    f.config.configs.dev.postProcessing.htmlOverlay.enabled = false;
    await runBuild(["dev", "--skip-build"], f);
    assert.equal(fs.readFileSync(path.join(f.output, "index.html"), "utf8").includes('id="qa"'), false);
});

test("disabled or omitted overlay removes existing blocks without a template", async t => {
    const customMarkers = { start: "<!-- PROJECT_QA_START -->", end: "<!-- PROJECT_QA_END -->" };
    for (const variant of ["disabled", "omitted", "custom-markers"]) {
        const f = fixture(t);
        const indexPath = path.join(f.output, "index.html");
        fs.writeFileSync(path.join(f.projectRoot, "overlay.html"), '<div id="qa">QA</div>');
        const markers = variant === "custom-markers" ? customMarkers : undefined;
        f.config.configs.dev.postProcessing = { htmlOverlay: { enabled: true, templatePath: "overlay.html", markers } };
        await runBuild(["dev", "--skip-build"], f);
        const withOverlay = fs.readFileSync(indexPath, "utf8");
        assert.ok(withOverlay.includes('id="qa"'));
        f.config.configs.dev.postProcessing = variant === "omitted"
            ? undefined : { htmlOverlay: { enabled: false, markers } };
        // Removing the source template must not prevent cleaning an existing block.
        fs.unlinkSync(path.join(f.projectRoot, "overlay.html"));
        await runBuild(["dev", "--skip-build", "--dry-run"], f);
        assert.equal(fs.readFileSync(indexPath, "utf8"), withOverlay);
        await runBuild(["dev", "--skip-build"], f);
        const cleaned = fs.readFileSync(indexPath, "utf8");
        assert.equal(cleaned.includes('id="qa"'), false, variant);
        assert.equal(cleaned.includes(markers?.start || "<!-- CWBT_OVERLAY_START -->"), false, variant);
        assert.ok(cleaned.includes("Another game"));
        await runBuild(["dev", "--skip-build"], f);
        assert.equal(fs.readFileSync(indexPath, "utf8"), cleaned);
    }
});

test("CLI finds config from explicit project root when launched elsewhere", t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.projectRoot, "cocos-build.config.cjs"), `module.exports = ${JSON.stringify(f.config)};`);
    const result = spawnSync(process.execPath, [path.resolve(__dirname, "../bin/cocos-web-build.js"), "build", "dev", "--skip-build", "--project", f.projectRoot], {
        cwd: os.tmpdir(), encoding: "utf8", windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /independent-game/);
});

test("missing tools and invalid versions preserve existing build output", async t => {
    const f = fixture(t);
    f.config.cocos = { executable: "missing-editor.exe" };
    await assert.rejects(runBuild(["dev"], f), /executable not found/);
    await assert.rejects(runBuild(["dev", "--skip-build", "--version", "../escape"], f), /Version must/);
    f.config.configs.dev.postProcessing = { zip: { enabled: true, toolPath: "missing-7z.exe", archiveName: "game" } };
    await assert.rejects(runBuild(["dev", "--skip-build"], f), /zip.toolPath not found/);
    f.config.configs.dev.buildOutputName = "web;buildPath=other";
    await assert.rejects(runBuild(["dev", "--skip-build"], f), /without semicolons/);
    assert.deepEqual(fs.readdirSync(f.output), ["index.html"]);
});

test("platform preparation copies project SDK files and patches hashed settings", async t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.projectRoot, "sdk.js"), "globalThis.exampleSdk = {};");
    fs.mkdirSync(path.join(f.output, "src"));
    fs.writeFileSync(path.join(f.output, "src", "settings.a1b2.json"), JSON.stringify({ screen: { width: 640, exactFitScreen: true } }));
    f.config.platforms = [{ id: "example", apiVersion: 1,
        label: "Example", sdkUrl: "example-sdk.js",
        files: { "example-sdk.js": "sdk.js" }, screen: { exactFitScreen: false },
    }];
    await runBuild(["dev", "--platform", "example", "--skip-build"], f);
    const settings = JSON.parse(fs.readFileSync(path.join(f.output, "src", "settings.a1b2.json")));
    assert.deepEqual(settings.screen, { width: 640, exactFitScreen: false });
    assert.equal(fs.readFileSync(path.join(f.output, "example-sdk.js"), "utf8"), "globalThis.exampleSdk = {};");
    const target = JSON.parse(fs.readFileSync(path.join(f.output, "platform-target.json")));
    assert.equal(target.platform, "example");
    assert.equal(target.sdkUrl, "example-sdk.js");
});

test("obfuscation resolves its own dependency and preserves script behavior", async t => {
    const f = fixture(t);
    fs.mkdirSync(path.join(f.output, "assets", "main"), { recursive: true });
    const script = path.join(f.output, "assets", "main", "index.js");
    const original = "globalThis.buildSmokeResult = ['a', 'b', 'c'].join('-');";
    fs.writeFileSync(script, original);
    fs.writeFileSync(path.join(f.projectRoot, "obfuscation.json"), JSON.stringify({ compact: true, seed: 1 }));
    f.config.configs.dev.postProcessing = { scriptObfuscation: { enabled: true, configPath: "obfuscation.json" } };
    await runBuild(["dev", "--skip-build"], f);
    const output = fs.readFileSync(script, "utf8");
    assert.notEqual(output, original);
    const sandbox = {};
    require("node:vm").runInNewContext(output, sandbox);
    assert.equal(sandbox.buildSmokeResult, "a-b-c");
});

test("preview serves static output with MIME types and blocks encoded traversal", async t => {
    const f = fixture(t);
    await runBuild(["dev", "--skip-build"], f);
    fs.writeFileSync(path.join(f.output, "sample.wasm"), "wasm");
    const probe = http.createServer();
    await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const { startStaticServer: startPreviewServer } = await import("../src/static-preview.mjs");
    const server = await startPreviewServer(f.output, { port, host: "127.0.0.1" });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const response = await fetch(`http://127.0.0.1:${port}/sample.wasm`);
    assert.equal(response.headers.get("content-type"), "application/wasm");
    assert.equal(await response.text(), "wasm");
    const denied = await fetch(`http://127.0.0.1:${port}/..%2f..%2fpackage.json`);
    assert.equal(denied.status, 404);
    assert.equal(loadProject(f).projectRoot, f.projectRoot);
});
