# Cocos Web Build Tools

A build pipeline for Cocos Creator web games. **Local builds and static preview work out of the box.** Add Yandex Games or VK Mini Apps by installing and registering an adapter.

## Packages

| Package | Includes |
| --- | --- |
| [`@darxel-llc/cocos-web-build-tools`](packages/core/README.md) | Creator builds, local adapter, image compression, obfuscation, ZIP, CLI and adapter contract |
| [`@darxel-llc/cocos-build-adapter-yandex`](packages/adapter-yandex/README.md) | Yandex target rules and SDK dev proxy preview |
| [`@darxel-llc/cocos-build-adapter-vk`](packages/adapter-vk/README.md) | VK Bridge files, screen settings, static preview and hosting upload |

Installing the core package does not install either platform adapter, VK Bridge or the VK uploader. A package being installed does not register it automatically. `local` remains the default unless the game sets `defaultPlatform`.

Initial supported environment: **Cocos Creator 3.8.8, Windows, Node.js 22+**.

## Install from GitHub Packages

Add this registry mapping to the game's `.npmrc` (no token in the repository):

```ini
@darxel-llc:registry=https://npm.pkg.github.com
```

Authenticate once using your GitHub username and a personal access token (classic) with `read:packages`, then install the packages you need:

```powershell
npm login --scope=@darxel-llc --auth-type=legacy --registry=https://npm.pkg.github.com
npm install --save-dev --save-exact @darxel-llc/cocos-web-build-tools@0.1.0
npm install --save-dev --save-exact @darxel-llc/cocos-build-adapter-yandex@0.1.0 @darxel-llc/cocos-build-adapter-vk@0.1.0
```

Even public npm packages on GitHub require authentication. For private packages, your account also needs read access. Authorize the token for your organization if it uses SSO. Keep credentials in your user npm configuration; never commit them. See [GitHub's npm registry guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

## Local development

```powershell
git clone https://github.com/Darxel-LLC/cocos-web-build-tools.git
cd cocos-web-build-tools
npm ci
```

This repository uses npm workspaces. From your game directory, link the packages you need (adjust paths):

```powershell
npm install --save-dev ../cocos-web-build-tools/packages/core
npm install --save-dev ../cocos-web-build-tools/packages/adapter-yandex
npm install --save-dev ../cocos-web-build-tools/packages/adapter-vk
```

Run `npm ci` in the workspace checkout too: dependencies of local directory links are resolved there. You can also pack the workspaces and install their `.tgz` files together; installing a Git monorepo root is not a substitute for installing its packages.

## Configure a game

```javascript
// cocos-build.config.cjs
const { yandex } = require("@darxel-llc/cocos-build-adapter-yandex");
const { vk } = require("@darxel-llc/cocos-build-adapter-vk");

module.exports = {
    cocos: { version: "3.8.8" },
    configs: {
        dev: {
            buildOptions: { configPath: "build-configs/dev.json" },
            buildOutputName: "web-mobile",
        },
    },
    platforms: [yandex(), vk()],
    // local is available and selected by default; no registration required.
};
```

Export `build-configs/dev.json` from your own Creator project. If you only need local builds, omit the imports and `platforms` entirely.

```powershell
npx cocos-web-build build dev
npx cocos-web-build build dev --platform yandex --dry-run
npx cocos-web-build preview dev
npx cocos-web-build menu --platform vk
```

The menu shows preview/deploy actions only when the selected adapter supplies them. Both menu and standalone preview dispatch through the same adapter contract. SDK initialization, game saves, purchases and custom HTML remain responsibilities of the game.

See the [core guide](packages/core/README.md) for pipeline settings and custom adapters, and each adapter's README for installation and platform behavior.

## Validate and package

From the repository root:

```powershell
npm run check
npm test
npm run pack:check
npm pack --workspaces
```

Each workspace has its own package manifest and MIT license. Adapters declare compatibility with core through `peerDependencies`. Publish/install core before or together with adapters. This repository itself is a private workspace root and is not an npm package to publish.

## Publish a version

Update the changed packages' versions and adapter peer dependencies as needed, run the checks above, and commit the lockfile with the manifests. Push to `main`, then run **Actions → Publish packages → Run workflow** on `main`.

The workflow validates the workspace on Windows with Node.js 22 and publishes core before its adapters. It uses the repository's `GITHUB_TOKEN` with `packages: write`; no personal publishing token is needed. Existing versions are skipped so a partially completed publication can be resumed. To release changed content, increment its version first. `npm run publish:packages -- --dry-run` previews publication locally.

GitHub initially creates packages with private visibility. To share them publicly, a package administrator must open each package's **Package settings → Change visibility → Public**. This does not remove the registry's authentication requirement for installation.

## License

[MIT](LICENSE) for our source code. No native executables or game assets are bundled. See [third-party components](packages/core/THIRD_PARTY.md) and adapter documentation for external dependencies.
