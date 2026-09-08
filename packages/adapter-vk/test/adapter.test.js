const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { vk } = require("../src/index.js");

test("VK provides SDK files from its dependency and both preview/deploy capabilities", () => {
    const adapter = vk();
    assert.equal(adapter.id, "vk");
    assert.equal(adapter.outputSuffix, "-vk");
    assert.equal(typeof adapter.preview, "function");
    assert.equal(typeof adapter.deploy, "function");
    assert.equal(adapter.screen.exactFitScreen, false);
    for (const source of Object.values(adapter.files)) {
        assert.ok(path.isAbsolute(source));
        assert.ok(fs.statSync(source).isFile());
    }
    assert.deepEqual(adapter.resolveTarget({ mode: "release" }), { sdkMode: "real", sdkUrl: "vk-bridge.js" });
    assert.throws(() => adapter.resolveTarget({ mode: "dev", sdkMode: "mock" }), /real SDK/);
});
