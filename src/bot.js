import "dotenv/config";
import { ethers } from "ethers";
import { getNetworkConfig, HF_THRESHOLD } from "./config.js";
import { Scanner } from "./scanner.js";
import { Liquidator } from "./liquidator.js";

// ──────────────────────────────────────────────────────────────────────────────
// Main bot loop
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Validate environment ─────────────────────────────────────────────
  const requiredEnv = ["RPC_URL", "PRIVATE_KEY", "LIQUIDATOR_CONTRACT_ADDRESS"];
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      console.error(`Missing env var: ${key}. Copy .env.example to .env and fill it in.`);
      process.exit(1);
    }
  }

  // ── 2. Setup provider & wallet ──────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const network = await provider.getNetwork();
  const networkConfig = getNetworkConfig(network.chainId);

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Aave Flash Loan Liquidator");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network    : ${networkConfig.name} (chainId ${network.chainId})`);
  console.log(`  Wallet     : ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`  Balance    : ${ethers.formatEther(balance)} ETH`);

  const liquidatorAddress = process.env.LIQUIDATOR_CONTRACT_ADDRESS.trim();
  if (!ethers.isAddress(liquidatorAddress)) {
    console.error(`Invalid LIQUIDATOR_CONTRACT_ADDRESS: "${liquidatorAddress}"`);
    process.exit(1);
  }
  console.log(`  Contract   : ${liquidatorAddress}`);
  console.log("═══════════════════════════════════════════════════════\n");

  // ── 3. Initialize scanner & liquidator ──────────────────────────────────
  const scanner = new Scanner(provider, networkConfig);
  const liquidator = new Liquidator(wallet, networkConfig, liquidatorAddress);

  // Scan historical events to build initial borrower set
  await scanner.initialize();

  // Start listening for new borrowers in real-time
  scanner.startEventListener();

  // ── 4. Main scanning loop ──────────────────────────────────────────────
  let scanCount = 0;
  let totalProfit = 0;
  let totalLiquidations = 0;

  console.log("\n🔍 Starting liquidation scanner...\n");

  provider.on("block", async (blockNumber) => {
    // Only scan every N blocks to avoid spamming the RPC
    if (blockNumber % networkConfig.scanIntervalBlocks !== 0) return;

    scanCount++;
    const borrowerCount = scanner.borrowers.size;

    if (borrowerCount === 0) {
      if (scanCount % 20 === 0) {
        console.log(`[Block ${blockNumber}] No borrowers tracked yet. Waiting...`);
      }
      return;
    }

    // Log progress periodically
    if (scanCount % 10 === 0) {
      console.log(
        `[Block ${blockNumber}] Checking ${borrowerCount} borrowers... ` +
        `(${totalLiquidations} liquidations, ${totalProfit.toFixed(4)} profit so far)`
      );
    }

    try {
      // Find positions with HF < 1.0
      const underwater = await scanner.findUnderwaterPositions();

      if (underwater.length === 0) return;

      console.log(
        `\n🚨 Found ${underwater.length} underwater position(s) at block ${blockNumber}!`
      );

      // Sort by largest debt first (most profitable)
      underwater.sort((a, b) =>
        a.totalDebtBase > b.totalDebtBase ? -1 : 1
      );

      for (const pos of underwater) {
        const hfFormatted = ethers.formatUnits(pos.healthFactor, 18);
        console.log(
          `\n  User: ${pos.user}\n` +
          `  Health Factor: ${hfFormatted}\n` +
          `  Collateral: $${ethers.formatUnits(pos.totalCollateralBase, 8)}\n` +
          `  Debt: $${ethers.formatUnits(pos.totalDebtBase, 8)}`
        );

        // Analyze which specific tokens to liquidate
        const position = await scanner.analyzePosition(pos.user);
        if (!position) {
          console.log("  ⏭️  Could not determine collateral/debt pair. Skipping.");
          continue;
        }

        console.log(
          `  Pair: ${position.collateralSymbol} → ${position.debtSymbol}\n` +
          `  Liquidation bonus: ${(position.liquidationBonus / 100 - 100).toFixed(1)}%`
        );

        // Attempt the liquidation
        const result = await liquidator.tryLiquidate(pos.user, position);

        if (result.success) {
          totalLiquidations++;
          totalProfit += parseFloat(result.profit);
          console.log(
            `  💰 Profit: ${result.profit} ${position.debtSymbol}\n` +
            `  TX: ${result.txHash}`
          );
        } else {
          console.log(`  ❌ Skipped: ${result.reason}`);
        }
      }
    } catch (err) {
      console.error(`[Block ${blockNumber}] Scan error:`, err.message);
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ──────────────────────────────────────────────────────────────────────────────
process.on("SIGINT", () => {
  console.log("\n\nShutting down...");
  process.exit(0);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
  // Don't exit — keep the bot running
});

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
