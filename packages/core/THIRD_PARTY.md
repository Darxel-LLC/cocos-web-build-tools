# Third-party components

This repository and its npm package contain no Cocos engine, game assets, fonts, platform SDK bundles, or native executables. npm dependencies are installed separately and keep their upstream license notices.

| Dependency | Version | License in its package metadata | Purpose |
| --- | --- | --- | --- |
| `@inquirer/prompts` | 7.10.1 | MIT | Interactive menu |
| `javascript-obfuscator` | 4.2.2 | BSD-2-Clause | Optional script obfuscation |

Platform-specific dependencies belong to separately installed adapters, not core. The workspace lockfile records dependencies of all packages for repository development; installing the packed core does not install the other workspaces.

The repository lockfile records transitive dependencies. Their licenses are not replaced by this project's MIT license.

## Tools supplied by the consuming project

- **Cocos Creator:** install the editor separately and point the build configuration to it.
- **Caesium CLI:** supply `caesiumclt` for PNG/JPEG compression. [Upstream](https://github.com/Lymphatus/caesium-clt).
- **SSIMULACRA2 Rust CLI:** supply a compatible `ssimulacra2_rs` with the `image <source> <candidate>` command and `Score:` output. [Upstream](https://github.com/rust-av/ssimulacra2).
- **7-Zip:** supply the executable and its runtime files for ZIP packaging. [Upstream license](https://www.7-zip.org/license.txt).
- **Platform SDKs:** the consuming game installs, loads and licenses any SDK files it copies into its build.

Record the source, version and checksum of native tools used by your project. If you redistribute their binaries, include the notices and fulfill the distribution requirements for those exact versions. This package does not grant rights to external binaries or game content.
