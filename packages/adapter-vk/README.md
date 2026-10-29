# VK Mini Apps build adapter

`@darxel-llc/cocos-build-adapter-vk` adds VK build preparation, static preview and hosting upload to `@darxel-llc/cocos-web-build-tools`. It requires core `^0.1.0` and adapter API 1.

Configure `@darxel-llc:registry=https://npm.pkg.github.com` in the game's `.npmrc` and log in with a GitHub personal access token (classic) with `read:packages`. Keep the token in your user npm configuration.

```powershell
npm login --scope=@darxel-llc --auth-type=legacy --registry=https://npm.pkg.github.com
npm install --save-dev --save-exact @darxel-llc/cocos-web-build-tools@0.1.0 @darxel-llc/cocos-build-adapter-vk@0.1.1
```

Local workspace directories and packed `.tgz` files are also supported. Register the adapter in the game's `cocos-build.config.cjs`:

```javascript
const { vk } = require("@darxel-llc/cocos-build-adapter-vk");
module.exports = {
    configs: require("./build-configs.json").configs,
    platforms: [vk()],
};
```

```powershell
npx cocos-web-build build release --platform vk
npx cocos-web-build preview release --platform vk
npx cocos-web-build menu --platform vk
```

The default suffix is `-vk`. The adapter copies its own pinned VK Bridge 3.0.2 dependency as `vk-bridge.js`, copies the SDK license, and sets Cocos `screen.exactFitScreen` to `false`. File resolution does not assume that the game has a `node_modules/@vkontakte/vk-bridge` directory. `outputSuffix`, `label`, extra `files`, `screen`, and build lifecycle hooks can be configured. SDK mode must be `real`.

Static preview helps inspect output, but actual platform services require the VK container and an accessible HTTPS address. The adapter does not implement the game's SDK bootstrap, purchases, saves, authorization or UI.

## Hosting upload

Copy [the example](vk-hosting-config.json.example) to `vk-hosting-config.json` in the game root. The menu offers build-and-deploy and deploy-existing actions. Uploading requires a matching VK build manifest, selection of application/environment and confirmation. Production requires a release build. Building or previewing never uploads anything.

The pinned official uploader runs in an isolated process with the game as its working directory. Selected values are changed only in that process's configuration cache; the hosting file is not rewritten. The uploader manages OAuth/token storage and its `build.zip` artifact. Programmatic callers can import `deployVkBuild` from `@darxel-llc/cocos-build-adapter-vk/deploy`; it retains the interactive selection and confirmation flow.

## Dependencies and license

Our adapter source is [MIT](LICENSE). Runtime npm dependencies are `@vkontakte/vk-bridge` 3.0.2 (MIT), `@vkontakte/vk-miniapps-deploy` 1.0.3 (MIT), and `@inquirer/prompts` 7.10.1 (MIT). They keep their own notices and transitive dependency licenses. No native binaries or game assets are bundled.
