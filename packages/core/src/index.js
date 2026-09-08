const { loadProject } = require("./context.js");
const { build } = require("./build.js");
const { parseBuildArgs, printBuildHelp } = require("./options.js");

async function runBuild(argv = process.argv.slice(2), projectOptions = {}) {
    const options = parseBuildArgs(argv);
    if (options.help) return printBuildHelp();
    return build(loadProject(projectOptions), options);
}

const { definePlatform, local } = require("./platforms.js");
module.exports = { runBuild, loadProject, definePlatform, local };
