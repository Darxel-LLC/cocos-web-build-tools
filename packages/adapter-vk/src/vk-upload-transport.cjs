const fs = require("node:fs");
const Module = require("node:module");

// vk-miniapps-deploy 1.0.3 retries the same multipart body after a transport
// failure. A form-data stream can only be consumed once. Keep the workaround
// at that package's imports, inside the disposable uploader process.
function loadDeploy() {
    const packageName = "@vkontakte/vk-miniapps-deploy";
    const entry = require.resolve(packageName);
    const uploads = new WeakMap();
    const originalLoad = Module._load;

    Module._load = function (request, parent, isMain) {
        const loaded = originalLoad.call(this, request, parent, isMain);
        if (parent?.filename !== entry) return loaded;

        if (request === "form-data") {
            return class ReplayableUploadForm extends loaded {
                append(name, value, options) {
                    super.append(name, value, options);
                    if (name === "file" && value instanceof fs.ReadStream && options?.contentType === "application/zip") {
                        uploads.set(this, { FormData: loaded, source: value, options: { ...options }, used: false });
                    }
                }
            };
        }

        if (request === "node-fetch") {
            return async function uploadFetch(url, options) {
                const upload = uploads.get(options?.body);
                if (!upload) return loaded(url, options);

                let form = options.body;
                let source = upload.source;
                if (upload.used) {
                    source = fs.createReadStream(upload.source.path);
                    form = new upload.FormData();
                    form.append("file", source, upload.options);
                }
                upload.used = true;
                try {
                    // Each form has a new boundary; the original headers belong
                    // to the original, already consumed form.
                    return await loaded(url, { ...options, body: form, headers: { ...options.headers, ...form.getHeaders() } });
                } catch (error) {
                    // node-fetch embeds the signed upload URL in its message.
                    // Upstream prints that message on every retry.
                    const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code) ? ` (${error.code})` : "";
                    throw new Error(`VK archive upload failed${code}. Check the network connection and retry deployment if the problem persists.`);
                } finally {
                    source.destroy();
                    form.destroy();
                }
            };
        }

        return loaded;
    };

    try {
        return require(packageName);
    } finally {
        Module._load = originalLoad;
    }
}

module.exports = { loadDeploy };
