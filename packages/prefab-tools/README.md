# Cocos Prefab Tools

Inspect, compare, validate and clean up serialized Cocos Creator prefabs and scenes from the terminal or CI. Targets Creator 3.8.8 and requires Node.js 22 or later. Creator can stay closed.

## Install

The package uses GitHub Packages. Map the registry in the project's `.npmrc` and authenticate with an account that can read the package. [GitHub Packages authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-to-github-packages)

```ini
@darxel-llc:registry=https://npm.pkg.github.com
```

```sh
npm install --save-dev --save-exact @darxel-llc/cocos-prefab-tools@0.1.0
```

For a local build, run `npm pack --workspace @darxel-llc/cocos-prefab-tools` from the tools repository. In the game project, pass the resulting `.tgz` path to `npm install --save-dev`.

## Use

Run the CLI from the root of a Creator project. It indexes `.meta` files under `assets/`. `lint` checks every `.prefab` and `.scene` under that directory by default. Pass asset paths to check a subset. It exits with status 1 for lint errors and 2 for command failures.

```sh
npx cocos-prefab lint --warnings
npx cocos-prefab tree assets/ui/Menu.prefab --depth 2
npx cocos-prefab node assets/ui/Menu.prefab Panel/Close
npx cocos-prefab refs assets/ui/Menu.prefab Panel/Close
npx cocos-prefab diff HEAD:assets/ui/Menu.prefab assets/ui/Menu.prefab
npx cocos-prefab help
```

Add `"check:prefabs": "cocos-prefab lint"` to your npm scripts to run the same check in CI. The TypeScript parser reads component source to check local property declarations. Diagnostics about properties inherited from other classes may need confirmation in Creator.

On Windows, the CLI uses `creator.version` in the project's `package.json` to locate the editor under `%ProgramData%/cocos/editors/Creator/`. Set `COCOS_CREATOR_PATH` to the editor executable to override this location. If the built-in asset directory is unavailable, unknown UUIDs produce warnings. Git is required for revision-based comparisons and patch previews.

## Prune

```sh
npx cocos-prefab prune assets/ui/Menu.prefab --dry-run --diff
npx cocos-prefab prune assets/ui/Menu.prefab
```

Review the patch before applying. Prune removes unreachable serialized objects and property overrides with confirmed missing targets. It validates the proposed content, blocks writes when a nested dependency is unavailable, and rejects concurrent changes to the asset. Writes replace each file atomically. Reload changed assets in Creator before continuing to edit them.
