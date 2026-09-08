/** Build adapters run in Node.js. Browser game services are a separate contract. */
export interface PlatformTarget {
    platform: string;
    mode: "dev" | "release";
    sdkMode: string;
    sdkUrl?: string;
    [publicSetting: string]: unknown;
}

export interface PreviewHandle {
    close(): void | Promise<void>;
    /** Long-running child processes expose termination and failures here. */
    finished?: Promise<void>;
}

export interface AdapterContext {
    projectRoot: string;
    buildPath: string;
    configName: string;
    target: PlatformTarget;
    dryRun: boolean;
    skipBuild?: boolean;
    version?: string;
    port?: number;
    host?: string;
    buildOptions?: Record<string, string | number | boolean>;
    resolveProjectPath(value: string): string;
    resolveBuildRootPath(...segments: string[]): string;
    resolveInside(root: string, ...segments: string[]): string;
}

export interface PlatformAdapter {
    apiVersion: 1;
    id: string;
    label: string;
    outputSuffix?: string;
    sdkUrl?: string;
    files?: Record<string, string>;
    screen?: Record<string, unknown>;
    resolveTarget?(input: { platform: string; mode: "dev" | "release"; sdkMode?: string }): { sdkMode: string; sdkUrl?: string; [publicSetting: string]: unknown };
    validate?(context: AdapterContext): void | Promise<void>;
    prepareBuild?(context: AdapterContext): void | Promise<void>;
    processBuild?(context: AdapterContext): void | Promise<void>;
    preview?(context: AdapterContext): PreviewHandle | Promise<PreviewHandle>;
    deploy?(context: AdapterContext): unknown | Promise<unknown>;
}
