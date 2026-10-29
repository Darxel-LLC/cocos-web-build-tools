const path = require("node:path");
async function main() {
    const configPath = path.join(process.cwd(), "vk-hosting-config.json");
    const config = require(configPath);
    for (const key of Object.keys(config)) delete config[key];
    Object.assign(config, JSON.parse(process.argv[2]));
    const deploy = require("./vk-upload-transport.cjs").loadDeploy();
    if (!await deploy.run(config)) throw new Error("VK deployment did not complete successfully.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
