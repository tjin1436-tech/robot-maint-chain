require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("solidity-coverage");
const path = require("path");
const fs = require("fs");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Use a native solc 0.8.28 at bin/solc when present; otherwise Hardhat downloads the compiler.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.28" && fs.existsSync(path.join(__dirname, "bin", "solc"))) {
    return {
      compilerPath: path.join(__dirname, "bin", "solc"),
      isSolcJs: false,
      version: args.solcVersion,
      longVersion: "0.8.28+commit.7893614a",
    };
  }
  return runSuper();
});

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  mocha: { timeout: 600000 },
};
