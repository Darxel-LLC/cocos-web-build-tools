const path = require("node:path");
const { definePlatform } = require("@darxel/cocos-web-build-tools");

function vk(options = {}) {
    const sdkRoot = path.dirname(require.resolve("@vkontakte/vk-bridge/package.json"));
    return definePlatform({
        ...options,
        id: "vk", apiVersion: 1,
        label: options.label || "VK Mini Apps",
        outputSuffix: options.outputSuffix ?? "-vk",
        sdkUrl: "vk-bridge.js",
        previewSdkUrl: "https://unpkg.com/@vkontakte/vk-bridge@3.0.2/dist/browser.min.js",
        files: {
            ...options.files,
            "vk-bridge.js": path.join(sdkRoot, "dist/browser.min.js"),
            "vk-bridge-LICENSE.txt": path.join(sdkRoot, "LICENSE"),
        },
        screen: { exactFitScreen: false, ...options.screen },
        resolveTarget({ mode, sdkMode = options.defaultSdkMode?.[mode] || "real" }) {
            if (sdkMode !== "real") throw new Error("VK builds require the real SDK.");
            return { sdkMode, sdkUrl: "vk-bridge.js" };
        },
        async preview(context) {
            const { startStaticServer } = await import("@darxel/cocos-web-build-tools/static-preview");
            const server = await startStaticServer(context.buildPath, context);
            return { close: () => new Promise((resolve, reject) => {
                server.closeAllConnections();
                server.close(error => error ? reject(error) : resolve());
            }) };
        },
        async deploy(context) {
            const { deployVkBuild } = await import("./vk-deploy.mjs");
            return deployVkBuild(context);
        },
    });
}

module.exports = { vk };
