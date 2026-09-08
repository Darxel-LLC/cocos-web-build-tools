const { test } = require("node:test");
const assert = require("node:assert/strict");
const { yandex } = require("../src/index.js");

test("Yandex supplies target and preview without a deployment action", () => {
    const adapter = yandex({ outputSuffix: "" });
    assert.equal(adapter.id, "yandex");
    assert.equal(adapter.outputSuffix, "");
    assert.equal(typeof adapter.preview, "function");
    assert.equal(adapter.deploy, undefined);
    assert.deepEqual(adapter.resolveTarget({ mode: "dev" }), { sdkMode: "real", sdkUrl: "/sdk.js" });
    assert.throws(() => adapter.resolveTarget({ mode: "dev", sdkMode: "mock" }), /real SDK/);
});

test("proxy uses a pinned cached package and isolates the upstream install-script restriction", async () => {
    const { proxyInvocation } = await import("../src/preview.mjs");
    const invocation = proxyInvocation("C:/example game/build/web", 12333);
    assert.equal(invocation.command, process.execPath);
    assert.ok(invocation.args.includes("--package=@yandex-games/sdk-dev-proxy@0.0.2"));
    assert.ok(invocation.args.includes("--ignore-scripts"));
    assert.ok(invocation.args.includes("C:/example game/build/web"));
    assert.throws(() => proxyInvocation("build", 0), /port/);
});
