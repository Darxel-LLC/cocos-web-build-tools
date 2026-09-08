# Yandex Games build adapter

`@darxel/cocos-build-adapter-yandex` adds Yandex target validation and SDK dev proxy preview to `@darxel/cocos-web-build-tools`. It requires core `^0.1.0` and adapter API 1.

Install the core and this adapter from their workspace directories or packed `.tgz` files. Then register it in the game's `cocos-build.config.cjs`:

```javascript
const { yandex } = require("@darxel/cocos-build-adapter-yandex");
module.exports = {
    configs: require("./build-configs.json").configs,
    platforms: [yandex({ outputSuffix: "-yandex" })],
    defaultPlatform: "yandex", // Otherwise core still defaults to local.
};
```

```powershell
npx cocos-web-build build release --platform yandex
npx cocos-web-build preview release --platform yandex --port 12333
```

The default suffix is `-yandex`; pass `""` to retain an existing unsuffixed output. The default SDK URL is `/sdk.js`. `sdkUrl`, `previewSdkUrl`, `label`, `files` and lifecycle hooks may be supplied as project options. `resolveTarget` accepts only `real`, including when `defaultSdkMode` is configured. No deploy capability is supplied.

Preview runs the official `@yandex-games/sdk-dev-proxy@0.0.2` through npm's cache. The first invocation may download it; subsequent invocations prefer cached content. The published proxy includes a pnpm-only `preinstall` guard despite shipping a compiled CLI. This adapter uses `npm exec --ignore-scripts` for that invocation only, so installing the adapter does not run that guard or change the game's npm configuration. A Node installation with npm, or launch through an npm script, is required.

The proxy serves HTTPS with its development certificate and uses its own host behavior; the generic static-preview `--host` setting does not configure it. Open the URL printed by the proxy. Programmatic preview returns `close()` and `finished`; closing also stops npm's proxy subprocess. The adapter does not initialize `YaGames` or provide game services. The game retains its HTML bootstrap and purchase catalog. Pass extra files through `files` when they need packaging.

Our adapter source is [MIT](LICENSE). The official proxy is fetched separately and retains its upstream terms; it is not bundled or relicensed by this package. [Official proxy documentation](https://yandex.ru/dev/games/doc/en/concepts/local-launch).
