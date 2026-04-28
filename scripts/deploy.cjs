const hre = require("hardhat");

async function main() {
  // ──────────────────────────────────────────────────────────────────────────
  // Contract addresses per network
  // Update these with the correct addresses for your target chain.
  // ──────────────────────────────────────────────────────────────────────────
  const addresses = {
    // Base Mainnet
    8453: {
      balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
      aavePool:      "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", // Aave V3 on Base (update when V4 launches)
      swapRouter:    "0x2626664c2603336E57B271c5C0b26F421741e481", // Uniswap V3 SwapRouter on Base
    },
    // Arbitrum One
    42161: {
      balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
      aavePool:      "0x794a61358D6845594F94dc1DB02A252b5b4814aD", // Aave V3 on Arbitrum
      swapRouter:    "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3 SwapRouter on Arbitrum
    },
  };

  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const config = addresses[Number(chainId)];

  if (!config) {
    throw new Error(
      `No addresses configured for chainId ${chainId}. ` +
      `Supported: ${Object.keys(addresses).join(", ")}`
    );
  }

  console.log(`Deploying to chain ${chainId}...`);
  console.log(`  Balancer Vault : ${config.balancerVault}`);
  console.log(`  Aave Pool      : ${config.aavePool}`);
  console.log(`  Swap Router    : ${config.swapRouter}`);

  const Liquidator = await hre.ethers.getContractFactory("Liquidator");
  const liquidator = await Liquidator.deploy(
    config.balancerVault,
    config.aavePool,
    config.swapRouter
  );

  await liquidator.waitForDeployment();
  const address = await liquidator.getAddress();

  console.log(`\n✅ Liquidator deployed to: ${address}`);
  console.log(`\nAdd this to your .env file:`);
  console.log(`LIQUIDATOR_CONTRACT_ADDRESS="${address}"`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
