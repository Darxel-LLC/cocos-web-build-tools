import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream";

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json", ".css": "text/css", ".wasm": "application/wasm",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
    ".woff2": "font/woff2", ".ttf": "font/ttf",
};

export async function startStaticServer(buildPath, { port = 12333, host = "0.0.0.0", target } = {}) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Preview port must be an integer from 1 to 65535.");
    }
    const root = fs.realpathSync(buildPath);
    target ??= JSON.parse(fs.readFileSync(path.join(root, "platform-target.json"), "utf8"));
    const server = http.createServer((request, response) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
            response.writeHead(405, { Allow: "GET, HEAD" }).end();
            return;
        }
        let filename;
        try {
            const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
            filename = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
            if (!isInside(root, filename) || !fs.statSync(filename).isFile()) {
                response.writeHead(404).end();
                return;
            }
            filename = fs.realpathSync(filename);
            if (!isInside(root, filename)) {
                response.writeHead(403).end();
                return;
            }
        } catch {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {
            "Content-Type": MIME_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream",
            "Content-Length": fs.statSync(filename).size,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        });
        if (request.method === "HEAD") {
            response.end();
            return;
        }
        pipeline(fs.createReadStream(filename), response, () => {});
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
    });
    console.log(`${target.platform} preview: http://localhost:${port}/ (${target.mode}/${target.sdkMode})`);
    if (host === "0.0.0.0") {
        for (const interfaces of Object.values(os.networkInterfaces())) {
            for (const address of interfaces ?? []) {
                if (address.family === "IPv4" && !address.internal) {
                    console.log(`LAN: http://${address.address}:${port}/`);
                }
            }
        }
    }
    console.log("Press Ctrl+C to stop.");
    return server;
}

function isInside(root, filename) {
    const relative = path.relative(root, filename);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

