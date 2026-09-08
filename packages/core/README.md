# Cocos Web Build Tools

Build, optimize, package and preview Cocos Creator web projects from one configurable CLI. Each game owns its scenes, HTML templates, SDK integration and build settings; the package supplies the build pipeline.

The initial supported environment is **Cocos Creator 3.8.8 on Windows with Node.js 22 or newer**. Other Creator versions and operating systems need validation and compatible external tools.

## Install for local development

Clone this repository and install its dependencies:

```powershell
git clone https://github.com/Darxel-LLC/cocos-web-build-tools.git
cd cocos-web-build-tools
npm ci
```

From your game's directory, install this checkout as a development dependency:

```powershell
npm install --save-dev ../cocos-web-build-tools/packages/core
```

Adjust the relative path for your directory layout. npm links a local directory; run `npm ci` in the tools checkout as well as in the game. Changes to the tools are immediately visible to linked games.

To use a self-contained package, run `npm pack --workspace @darxel/cocos-web-build-tools` from the repository root and install the resulting `.tgz` in the game. This repository is a monorepo: install individual workspace packages, not its root. Availability in the npm registry is not assumed.

## First build

1. Open your game in Creator and export its web-mobile build settings for dev and release. Keep those files in the game, including its scene UUIDs.
2. Copy [the example configuration](examples/cocos-build.config.cjs) to `cocos-build.config.cjs` in the game root. Adjust the two `configPath` values.
3. Run from the game directory:

```powershell
npx cocos-web-build build dev --dry-run
npx cocos-web-build build dev
npx cocos-web-build preview dev --host 127.0.0.1
```

On Windows the default Creator executable is derived from `cocos.version` or the game's `package.json` `creator.version`. Override it with `COCOS_CREATOR_PATH` or `cocos.executable`.

```powershell
$env:COCOS_CREATOR_PATH = 'D:/Cocos/Creator/3.8.8/CocosCreator.exe'
npx cocos-web-build menu
npx cocos-web-build build release --version 1.2.3
npx cocos-web-build build dev --project C:/games/my-game
```

The package does not modify source scenes or install a game runtime. Creator still executes the game's own builder extensions.

## Commands

| Command | Behavior |
| --- | --- |
| `build <config>` | Creator build, platform preparation, optional post-processing and ZIP |
| `preview [config]` | Run the selected adapter's preview for an existing build; static preview defaults to `0.0.0.0` for LAN access |
| `menu [--platform <name>]` | Choose a platform, build, preview or deploy interactively |

Global options: `--project <path>` and `--config-file <path>` (relative to the project root). Build options: `--platform`, `--sdk-mode`, `--version`, `--dry-run`, `--skip-build`, `--no-compress`, `--no-obfuscate`. Preview options: `--platform`, `--port`, `--host`.

`--skip-build` processes the selected output in place. Repeated image compression can reduce quality further; build again from source for a clean release. A dry run reads configuration and may inspect existing assets and executable capabilities, but the built-in stages do not write output or deploy. Project hooks receive `dryRun` and must honor it.

## Configuration

`cocos-build.config.cjs` exports a trusted JavaScript object. Paths resolve from the **game root**, regardless of where this package is installed or where the CLI is launched with `--project`.

| Field | Default / purpose |
| --- | --- |
| `configs` | Required map of build profiles |
| `configs.<name>.buildOptions` | Creator CLI settings, usually `{ configPath: "...json" }` |
| `configs.<name>.buildOutputName` | Required output directory name; `buildOptions.outputName` is also accepted |
| `configs.<name>.mode` | `dev` or `release`; defaults to the profile name |
| `buildRoot` | `build`, inside the project; overrides Creator's build destination |
| `platforms` | Optional array of adapter instances; built-in local is always available |
| `defaultPlatform` | `local`, even when other adapters are registered |
| `previewPlatform` | Default platform for the standalone preview command |
| `metadataPath` | `.cocos-build/state.json`, inside the game |
| `defaultVersion` | Initial version suggested by the interactive menu |
| `versionStrategy` | Direct builds use the game's package version or `0.1.0`; `git-zero-minor` finds the next `0.N` tag number |
| `resolveVersion(context)` | Optional synchronous version resolver for direct builds without `--version` |
| `cocos.executable`, `cocos.version` | Creator executable selection; environment override takes precedence |

Profiles may have any name when they specify `mode`. Versions name archives; the tool does not write Git tags or change the game's version. The menu remembers its chosen version rather than incrementing it.

### Optional post-processing

All stages are disabled by default. Add `postProcessing` to a profile to enable them:

```javascript
postProcessing: {
    htmlOverlay: {
        enabled: true,
        templatePath: "build-support/qa.html",
        // Optional custom start/end HTML comment markers for an existing game.
    },
    imageCompression: {
        enabled: true,
        toolPath: "tools/caesiumclt.exe",
        ssimulacra2ToolPath: "tools/ssimulacra2_rs.exe",
        overridesPath: "build-support/image-overrides.json", // optional
        minSavings: "1%",
        png: { quality: 30, optimizationLevel: 6 },
        jpg: { qualitySteps: [60, 70, 80, 90], minSsimulacra2Score: 60 },
        parallelism: { pngThreads: 0, jpegConcurrency: 0 }, // automatic
    },
    scriptObfuscation: {
        enabled: true,
        inputPath: "assets/main", // relative to the build output
        configPath: "build-support/obfuscation.json",
    },
    zip: {
        enabled: true,
        archiveName: "my-game-release",
        toolPath: "tools/7z.exe",
        compressionLevel: 1,
    },
}
```

Choose compression settings for your art. JPEG candidates are evaluated with SSIMULACRA2; the original is retained when no candidate meets the score/savings requirements or evaluation fails. PNG processing uses Caesium batch compression. No external executables are bundled; see [third-party tools](THIRD_PARTY.md).

Image overrides have the shape `{ "images": [{ "asset": "assets/ui/logo.png", "processing": "lossless", "reason": "Preserve UI edges" }] }`. Use either `asset` or `uuid`; `processing` is `lossless` or `skip`. Asset paths require Cocos `.meta` UUIDs. `.pac` overrides also need the generated atlas mapping from Creator. The default reader targets Creator 3.8.8's `temp/asset-db/.../build1.0.1/texture-packerbuild/pac-info.json`; override `cocos.resolveAtlasInfoPath({ projectRoot, uuid, asset })` for a different compatible mapping location. An absent override manifest is treated as an empty list, and unmatched entries produce warnings.

### Built-in local and optional adapters

Core includes `local` with static HTTP preview, no external SDK and `real` SDK mode. No platform registration is required for local builds. To customize it, include `local(options)` once in the array:

```javascript
const { local } = require("@darxel/cocos-web-build-tools");
const { yandex } = require("@darxel/cocos-build-adapter-yandex");
const { vk } = require("@darxel/cocos-build-adapter-vk");

// In your exported config:
platforms: [
    local({ outputSuffix: "-local", defaultSdkMode: { dev: "mock", release: "real" } }),
    yandex({ outputSuffix: "-yandex" }),
    vk({ outputSuffix: "-vk" }),
],
```

Install the adapter packages separately. Yandex and VK are not dependencies of core. Local permits `mock` only in dev; other adapters own their SDK-mode rules. Declaring `mock` does not implement fake game services.

Platform instances share `id`, `label`, `apiVersion: 1`, `outputSuffix`, optional `files` (output filename to source path), `screen`, and lifecycle functions. Files may use absolute paths resolved by an adapter from its own dependencies; relative paths resolve from the game root. Source SDK files and their licenses are copied only for the selected platform.

### Write a custom adapter

A project module and an npm package implement the same contract. No registry service or core modification is needed:

```javascript
const { definePlatform } = require("@darxel/cocos-web-build-tools");

module.exports = function customPlatform() {
    return definePlatform({
        id: "custom",
        label: "My platform",
        outputSuffix: "-custom",
        resolveTarget({ sdkMode = "real" }) {
            if (sdkMode !== "real") throw new Error("Only the real SDK is supported");
            return { sdkMode };
        },
        async validate(context) { /* Read-only validation before build changes. */ },
        async processBuild(context) {
            if (context.dryRun) return;
            // Update this platform's output here.
        },
    });
};
```

Register it with `platforms: [require("./build-support/custom-platform.cjs")()]`. `definePlatform` supplies the API version; adapters returned without the helper must declare it explicitly. Duplicate IDs and unsupported API versions fail before Creator starts. One explicit `local()` instance replaces the built-in defaults.

| Adapter member | Contract |
| --- | --- |
| `resolveTarget({ platform, mode, sdkMode })` | Synchronous public settings, including `sdkMode`. Core supplies `platform` and `mode`. Defaults to requested SDK mode or `real`. Never return credentials. |
| `validate(context)` | Optional read-only validation before hooks and Creator |
| `prepareBuild(context)` | Optional preparation before Creator, including with `--skip-build`; can adjust `context.buildOptions`, while output paths remain owned by core |
| `processBuild(context)` | Optional output processing after platform files/settings and before the game's HTML hook |
| `preview(context)` | Optional start action returning `{ close(), finished? }`; `finished` reports child-process termination/errors |
| `deploy(context)` | Optional explicit upload action; never called by build or dry-run |

Type-only declarations are available from `@darxel/cocos-web-build-tools/types`. Distributed adapters should declare a compatible core version through `peerDependencies`.

The CLI derives actions from `preview` and `deploy` functions. There are no SDK-specific transport strings or platform-name branches in the menu. `cocos-web-build preview --platform <id>` calls that same `preview` function, including for dedicated proxies. The raw static server is exported from `@darxel/cocos-web-build-tools/static-preview` for adapters to reuse.

Build lifecycle:

1. Resolve and validate configuration/target.
2. Adapter `validate`, project `beforeBuild`, adapter `prepareBuild`.
3. Validate final files/options, then clean output and run Creator (unless `--skip-build`).
4. Invalidate the previous target manifest; copy platform files and patch Cocos screen settings.
5. Adapter `processBuild`, project `preparePlatform`, HTML overlay, compression, obfuscation.
6. Project `afterProcess`, write `platform-target.json`, then ZIP.

All build hooks are awaited and receive `dryRun`. Built-in stages avoid output writes during a dry run; custom hooks must do the same. A failed processing stage leaves no valid target manifest for preview/deploy. The manifest records public launch settings, not adapter code or private configuration.

### Project hooks and game runtime

```javascript
hooks: {
    async beforeBuild(context) { /* Validate game inputs. */ },
    async preparePlatform(context) { /* Connect your HTML/SDK bootstrap. */ },
    async afterProcess(context) { /* Extra output processing before ZIP. */ },
},
```

Build hooks receive `projectRoot`, `config`, `buildPath`, `target`, `configName`, `version`, `dryRun`, `skipBuild`, `buildOptions`, `postProcessing`, and path helpers. Preview/deploy contexts also receive the recorded target and action options such as `port`/`host`.

Game scenes, HTML templates, SDK initialization, purchases, saves and QA interfaces remain outside the build adapters. A game may keep serializable HTML runtime settings in JSON and pass those same settings into adapter factories, avoiding separate copies of project options. Installing an adapter does not initialize its SDK in the browser.

## Programmatic use

```javascript
const { runBuild } = require("@darxel/cocos-web-build-tools");
await runBuild(["release", "--version", "1.2.3"], { projectRoot: "C:/games/my-game" });
```

`runBuild` returns `{ buildPath, archivePath, target, version, dryRun }`. It also accepts an in-memory config through `{ projectRoot, config }`. Importing the package does not start a build. ESM entry points expose `runCli` at `/cli`, `runPreview` at `/preview`, and `startStaticServer` at `/static-preview`. `runPreview` returns a preview handle; call `close()` to stop it and handle `finished` when present. `/platforms` exports the adapter registry helpers.

## Development and validation

From the repository root:

```powershell
npm ci
npm run check
npm test
npm run pack:check
```

The tests use independent temporary projects for pipeline execution, dry-run, target validation, path containment, CLI root resolution, overlay processing and HTTP preview. They do not require Creator or deploy to a platform. Real Creator builds, compressor compatibility and deployment need validation in a consuming game. Keep changes scoped to the build tooling and include a regression test for changed behavior.

## License

The package's own source code is licensed under [MIT](LICENSE). External tools and dependencies retain their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md).
