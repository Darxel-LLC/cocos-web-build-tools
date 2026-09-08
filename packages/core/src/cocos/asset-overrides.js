const fs = require("node:fs");
const path = require("node:path");

function createAssetOverrides(context) {
    const { projectRoot: PROJECT_ROOT, resolveProjectPath } = context;
    function readImageCompressionOverrides(overridesPathConfig) {
        if (!overridesPathConfig) return { entries: [], byUuid: new Map(), byPackedUuid: new Map() };
        const overridesPath = resolveProjectPath(overridesPathConfig);
        if (!fs.existsSync(overridesPath)) {
            return { entries: [], byUuid: new Map(), byPackedUuid: new Map() };
        }

        let manifest;
        try {
            manifest = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
        } catch (error) {
            throw new Error(`Failed to parse image compression overrides ${overridesPath}: ${error.message}`);
        }

        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !Array.isArray(manifest.images)) {
            throw new Error(`Image compression overrides ${overridesPath} must contain an "images" array.`);
        }

        const entries = manifest.images.map((value, index) => parseImageCompressionOverride(value, index, overridesPath));
        const byUuid = new Map();
        const byPackedUuid = new Map();
        for (const entry of entries) {
            if (entry.uuid) {
                const duplicate = byUuid.get(entry.uuid);
                if (duplicate) {
                    throw new Error(`Image compression overrides ${overridesPath} contain duplicate UUID ${entry.uuid}: ${duplicate.label} and ${entry.label}.`);
                }
                byUuid.set(entry.uuid, entry);
            }
            if (entry.pacImageUuids) {
                for (const packedUuid of entry.pacImageUuids) {
                    const duplicate = byPackedUuid.get(packedUuid);
                    if (duplicate) {
                        throw new Error(`Image compression overrides ${overridesPath} contain duplicate packed texture UUID ${packedUuid}: ${duplicate.label} and ${entry.label}.`);
                    }
                    byPackedUuid.set(packedUuid, entry);
                }
            }
        }

        return { entries, byUuid, byPackedUuid };
    }

    function parseImageCompressionOverride(value, index, overridesPath) {
        const propertyPath = `images[${index}]`;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error(`Image compression overrides ${overridesPath} ${propertyPath} must be an object.`);
        }
        if (value.processing !== "skip" && value.processing !== "lossless") {
            throw new Error(`Image compression overrides ${overridesPath} ${propertyPath}.processing must be "skip" or "lossless".`);
        }
        if (typeof value.reason !== "string" || value.reason.trim().length === 0) {
            throw new Error(`Image compression overrides ${overridesPath} ${propertyPath}.reason must be a non-empty string.`);
        }

        const hasAsset = typeof value.asset === "string" && value.asset.length > 0;
        const hasUuid = typeof value.uuid === "string" && value.uuid.length > 0;
        if (hasAsset === hasUuid) {
            throw new Error(`Image compression overrides ${overridesPath} ${propertyPath} must contain exactly one of "asset" or "uuid".`);
        }

        if (hasUuid) {
            const uuid = value.uuid.toLowerCase();
            if (!isUuidLike(uuid)) {
                throw new Error(`Image compression overrides ${overridesPath} ${propertyPath}.uuid is not a valid UUID.`);
            }
            return { uuid, processing: value.processing, reason: value.reason.trim(), label: `UUID ${uuid}`, matches: 0 };
        }

        const asset = value.asset.replace(/\\/g, "/");
        if (!asset.startsWith("assets/") || path.posix.normalize(asset) !== asset || !/\.(png|jpe?g|pac)$/i.test(asset)) {
            throw new Error(`Image compression overrides ${overridesPath} ${propertyPath}.asset must be a normalized PNG/JPG/PAC path under assets/.`);
        }

        const assetPath = resolveProjectPath(asset);
        if (!fs.existsSync(assetPath)) {
            throw new Error(`Image compression override asset not found: ${asset}`);
        }

        const metaPath = `${assetPath}.meta`;
        if (!fs.existsSync(metaPath)) {
            throw new Error(`Image compression override metadata not found: ${asset}.meta`);
        }

        let meta;
        try {
            meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        } catch (error) {
            throw new Error(`Failed to parse image compression override metadata ${asset}.meta: ${error.message}`);
        }

        const uuid = typeof meta.uuid === "string" ? meta.uuid.toLowerCase() : "";
        if (!isUuidLike(uuid)) {
            throw new Error(`Image compression override metadata ${asset}.meta does not contain a valid root UUID.`);
        }

        const isPac = /\.pac$/i.test(asset);
        if (!isPac) {
            return { asset, uuid, processing: value.processing, reason: value.reason.trim(), label: asset, matches: 0 };
        }

        const pacImageUuids = readPacPackedImageUuids(uuid, asset, overridesPath, propertyPath);
        return {
            asset,
            pacUuid: uuid,
            pacImageUuids,
            processing: value.processing,
            reason: value.reason.trim(),
            label: asset,
            matches: 0,
        };
    }

    function readPacPackedImageUuids(pacUuid, asset, overridesPath, propertyPath) {
        const pacInfoPath = context.config.cocos?.resolveAtlasInfoPath
            ? context.config.cocos.resolveAtlasInfoPath({ projectRoot: PROJECT_ROOT, uuid: pacUuid, asset })
            : path.join(
            PROJECT_ROOT,
            "temp",
            "asset-db",
            "assets",
            pacUuid.slice(0, 2),
            pacUuid,
            "build1.0.1",
            "texture-packerbuild",
            "pac-info.json",
        );
        if (!fs.existsSync(pacInfoPath)) {
            throw new Error(
                `Image compression overrides ${overridesPath} ${propertyPath}: packed atlas info not found for ${asset}. ` +
                    `Expected ${path.relative(PROJECT_ROOT, pacInfoPath)}. Open the project in Cocos Creator to refresh it.`,
            );
        }

        let pacInfo;
        try {
            pacInfo = JSON.parse(fs.readFileSync(pacInfoPath, "utf8"));
        } catch (error) {
            throw new Error(`Failed to parse packed atlas info ${path.relative(PROJECT_ROOT, pacInfoPath)}: ${error.message}`);
        }

        const atlases = pacInfo?.result?.atlases;
        if (!Array.isArray(atlases) || atlases.length === 0) {
            throw new Error(`Packed atlas info for ${asset} does not contain any atlases in ${path.relative(PROJECT_ROOT, pacInfoPath)}.`);
        }

        const imageUuids = [];
        for (const atlas of atlases) {
            const atlasUuid = typeof atlas?.imageUuid === "string" ? atlas.imageUuid.toLowerCase() : "";
            if (!atlasUuid) {
                throw new Error(`Packed atlas info for ${asset} is missing imageUuid in ${path.relative(PROJECT_ROOT, pacInfoPath)}.`);
            }
            imageUuids.push(atlasUuid);
        }
        return imageUuids;
    }
    function isUuidLike(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
    }
    return { readImageCompressionOverrides };
}

module.exports = { createAssetOverrides };
