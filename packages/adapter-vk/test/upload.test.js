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
                if (Module._load !== scopedLoad) throw new Error('Module load hook was not restored');
                const cached = require(require('node:path').join(process.cwd(), 'vk-hosting-config.json'));
                if (cached !== config) throw new Error('Uploader did not receive cached project config');
                require('node:fs').writeFileSync('upload-observed.json', JSON.stringify({ config, environment: process.env.MINI_APPS_ENVIRONMENT }));
                return true;
            } };
        };
        const scopedLoad = Module._load;
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

// Run the installed deploy package and its real ZIP/multipart implementations.
// Only node-fetch's network transport is replaced; it consumes every upload
// completely before failing, reproducing the exhausted-stream regression.
function runUpload(t, failureMode) {
    const f = fixture(t);
    const hostingPath = path.join(f.projectRoot, "vk-hosting-config.json");
    const original = JSON.stringify({ app_id: 1, static_path: "old", debug: true });
    fs.writeFileSync(hostingPath, original);
    fs.mkdirSync(path.join(f.projectRoot, "web"));
    fs.writeFileSync(path.join(f.projectRoot, "web/index.html"), "<html>VK build fixture</html>");
    fs.writeFileSync(path.join(f.projectRoot, "web/audio.bin"), require("node:crypto").randomBytes(192 * 1024));
    const preload = path.join(f.projectRoot, "transport.cjs");
    const deployEntry = require.resolve("@vkontakte/vk-miniapps-deploy");
    const fetchEntry = require.resolve("node-fetch", { paths: [path.dirname(deployEntry)] });
    fs.writeFileSync(preload, `
        const assert = require('node:assert/strict');
        const fs = require('node:fs');
        const Module = require('node:module');
        const actualFetch = require(${JSON.stringify(fetchEntry)});
        const deployEntry = ${JSON.stringify(deployEntry)};
        const originalLoad = Module._load;
        const result = { version: require(${JSON.stringify(path.join(path.dirname(deployEntry), "package.json"))}).version, uploads: [], api: {}, closed: [] };
        const streams = [];
        const failureMode = ${JSON.stringify(failureMode)};
        const uploadUrl = 'https://upload.example.invalid/archive?token=fixture-upload-secret';
        const json = value => new actualFetch.Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
        async function transport(url, options) {
            if (url === uploadUrl) {
                assert.equal(options.method, 'POST');
                result.requests = (result.requests || 0) + 1;
                const source = options.body._streams.find(value => value?.source instanceof fs.ReadStream)?.source;
                assert.ok(source instanceof fs.ReadStream, 'Upload must contain a real file stream');
                streams.push(source);
                if (failureMode === 'before-read' && result.requests === 1) {
                    const error = new Error('request to ' + uploadUrl + ' failed before reading the archive');
                    error.code = 'EAI_AGAIN';
                    throw error;
                }
                const bytes = await new Promise((resolve, reject) => {
                    const chunks = [];
                    options.body.on('data', chunk => chunks.push(Buffer.from(chunk)));
                    options.body.on('end', () => resolve(Buffer.concat(chunks)));
                    options.body.on('error', reject);
                    options.body.resume();
                });
                const boundary = options.headers['content-type'].split('boundary=')[1];
                assert.ok(boundary, 'Missing multipart boundary');
                assert.ok(bytes.subarray(0, boundary.length + 4).equals(Buffer.from('--' + boundary + '\\r\\n')));
                const headerEnd = bytes.indexOf('\\r\\n\\r\\n');
                const trailer = Buffer.from('\\r\\n--' + boundary + '--\\r\\n');
                assert.ok(bytes.subarray(-trailer.length).equals(trailer), 'Incomplete multipart terminator');
                const file = bytes.subarray(headerEnd + 4, -trailer.length);
                assert.ok(file.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])), 'Expected ZIP file');
                assert.ok(file.equals(fs.readFileSync('build.zip')), 'Retry must send the entire archive');
                result.uploads.push({ boundary, length: file.length });
                if (failureMode === 'always' || (failureMode === 'once' && result.uploads.length === 1)) {
                    const error = new Error('request to ' + uploadUrl + ' failed: getaddrinfo EAI_AGAIN upload.example.invalid');
                    error.code = 'EAI_AGAIN';
                    throw error;
                }
                return json({ uploaded: true });
            }
            const method = new URL(url).pathname.split('/').pop();
            result.api[method] = (result.api[method] || 0) + 1;
            switch (method) {
                case 'apps.getGoHostingUploadServer': return json({ response: { upload_url: uploadUrl } });
                case 'apps.createGoHostingTask':
                    assert.deepEqual(JSON.parse(Buffer.from(new URL(url).searchParams.get('upload_response'), 'base64')), { uploaded: true });
                    return json({ response: { version: 'test-version' } });
                case 'apps.subscribeToHostingQueue': return json({ response: { base_url: 'https://queue.example.invalid/poll', key: 'fixture-key', ts: 1, app_id: 123 } });
                case 'poll': return json({ ts: 2, events: [1, 2].map(environment => ({ data: { type: 'success', code: 202, message: { environment } } })) });
                default: throw new Error('Unexpected network operation');
            }
        }
        Module._load = function (request, parent, isMain) {
            if (request === 'node-fetch' && parent?.filename === deployEntry) return transport;
            return originalLoad.call(this, request, parent, isMain);
        };
        process.on('exit', () => {
            result.closed = streams.map(source => source.destroyed);
            fs.writeFileSync('transport-observed.json', JSON.stringify(result));
        });
    `);
    const config = { app_id: 123, static_path: "web", endpoints: { web: "index.html" }, update_prod: false, update_dev: true };
    const child = spawnSync(process.execPath, ["--require", preload, path.resolve(__dirname, "../src/vk-upload.cjs"), JSON.stringify(config)], {
        cwd: f.projectRoot, encoding: "utf8", windowsHide: true, timeout: 15_000,
        env: { ...process.env, MINI_APPS_ACCESS_TOKEN: "fixture-access-token", MINI_APPS_ENVIRONMENT: "dev" },
    });
    assert.ifError(child.error);
    assert.equal(fs.readFileSync(hostingPath, "utf8"), original);
    return { child, observed: JSON.parse(fs.readFileSync(path.join(f.projectRoot, "transport-observed.json"))) };
}

test("installed VK deploy retries with a fresh complete ZIP multipart stream", t => {
    const { child, observed } = runUpload(t, "once");
    assert.equal(child.status, 0, child.stderr);
    assert.equal(observed.version, "1.0.3");
    assert.equal(observed.uploads.length, 2);
    assert.notEqual(observed.uploads[0].boundary, observed.uploads[1].boundary);
    assert.equal(observed.uploads[0].length, observed.uploads[1].length);
    assert.ok(observed.uploads[0].length > 192 * 1024);
    assert.deepEqual(observed.closed, [true, true]);
    assert.equal(observed.api["apps.getGoHostingUploadServer"], 1);
    assert.equal(observed.api["apps.createGoHostingTask"], 1);
    assert.equal(observed.api["apps.subscribeToHostingQueue"], 1);
    assert.match(child.stderr, /RETRY 1\/2/);
    assert.doesNotMatch(child.stdout + child.stderr, /fixture-upload-secret|upload\.example\.invalid|fixture-access-token/);
});

test("permanent upload transport failure stops after upstream's three attempts and redacts its signed URL", t => {
    const { child, observed } = runUpload(t, "always");
    assert.equal(child.status, 1, child.stderr);
    assert.equal(observed.uploads.length, 3);
    assert.equal(new Set(observed.uploads.map(upload => upload.boundary)).size, 3);
    assert.deepEqual(observed.closed, [true, true, true]);
    assert.equal(observed.api["apps.getGoHostingUploadServer"], 1);
    assert.equal(observed.api["apps.createGoHostingTask"], undefined);
    assert.match(child.stderr, /failed after 3 attempts/);
    assert.match(child.stderr, /EAI_AGAIN/);
    assert.doesNotMatch(child.stdout + child.stderr, /fixture-upload-secret|upload\.example\.invalid|fixture-access-token/);
});

test("an upload failure before reading the archive closes its stream and retries successfully", t => {
    const { child, observed } = runUpload(t, "before-read");
    assert.equal(child.status, 0, child.stderr);
    assert.equal(observed.requests, 2);
    assert.equal(observed.uploads.length, 1);
    assert.deepEqual(observed.closed, [true, true]);
    assert.doesNotMatch(child.stdout + child.stderr, /fixture-upload-secret|upload\.example\.invalid|fixture-access-token/);
});

