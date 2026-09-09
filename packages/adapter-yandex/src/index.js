const { definePlatform } = require("@darxel-llc/cocos-web-build-tools");

function yandex(options = {}) {
    return definePlatform({
        ...options,
        id: "yandex", apiVersion: 1,
        label: options.label || "Yandex Games",
        outputSuffix: options.outputSuffix ?? "-yandex",
        sdkUrl: options.sdkUrl || "/sdk.js",
        previewSdkUrl: options.previewSdkUrl || "https://sdk.games.s3.yandex.net/sdk.js",
        resolveTarget({ mode, sdkMode = options.defaultSdkMode?.[mode] || "real" }) {
            if (sdkMode !== "real") throw new Error("Yandex builds require the real SDK.");
            return { sdkMode, sdkUrl: options.sdkUrl || "/sdk.js" };
        },
        async preview(context) {
            const { startYandexProxy } = await import("./preview.mjs");
            return startYandexProxy(context);
        },
    });
}

module.exports = { yandex };
