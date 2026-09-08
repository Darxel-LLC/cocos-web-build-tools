const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
function fixture(t) {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cwbt-vk-test-"));
    t.after(() => {
        if (path.dirname(projectRoot) !== fs.realpathSync(os.tmpdir())) throw new Error("Invalid cleanup path");
        fs.rmSync(projectRoot, { recursive: true, force: true });
    });
    return { projectRoot };
}
test("VK uploader worker uses the consuming project's config without writing choices to disk", t => {
    const f = fixture(t);
    const hostingPath = path.join(f.projectRoot, "vk-hosting-config.json");
    const original = JSON.stringify({ app_id: 1, static_path: "old" });
    fs.writeFileSync(hostingPath, original);
    const stub = path.join(f.projectRoot, "fake-uploader.cjs");
    fs.writeFileSync(stub, `
        const Module = require('node:module');
        const originalLoad = Module._load;
        Module._load = function(id, ...args) {
            if (id !== '@vkontakte/vk-miniapps-deploy') return originalLoad.call(this, id, ...args);
            return { async run(config) {
                const cached = require(require('node:path').join(process.cwd(), 'vk-hosting-config.json'));
                if (cached !== config) throw new Error('Uploader did not receive cached project config');
                require('node:fs').writeFileSync('upload-observed.json', JSON.stringify({ config, environment: process.env.MINI_APPS_ENVIRONMENT }));
                return true;
            } };
        };
    `);
    const config = { app_id: 123, static_path: "build/web", update_prod: false, update_dev: true };
    const result = spawnSync(process.execPath, ["--require", stub, path.resolve(__dirname, "../src/vk-upload.cjs"), JSON.stringify(config)], {
        cwd: f.projectRoot, encoding: "utf8", windowsHide: true,
        env: { ...process.env, MINI_APPS_ENVIRONMENT: "dev" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.projectRoot, "upload-observed.json"))), { config, environment: "dev" });
    assert.equal(fs.readFileSync(hostingPath, "utf8"), original);
});

