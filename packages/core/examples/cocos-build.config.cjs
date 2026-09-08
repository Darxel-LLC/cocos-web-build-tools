// Copy this file to your Cocos project's root. Export the build settings for
// your scenes from Creator to build-configs/dev.json and release.json.
module.exports = {
    cocos: { version: "3.8.8" },
    defaultPlatform: "local",
    configs: {
        dev: {
            buildOptions: { configPath: "build-configs/dev.json" },
            buildOutputName: "web-mobile",
        },
        release: {
            buildOptions: { configPath: "build-configs/release.json" },
            buildOutputName: "web-mobile-release",
        },
    },
};
