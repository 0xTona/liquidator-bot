import "dotenv/config";
import { ethers } from "ethers";

// Updated ABI to match the fixed contract signature
const LiquidatorABI = [
  "function executeLiquidation(address collateralAsset, address debtAsset, address targetUser, uint256 debtToCover, uint24 swapFeeTier, uint256 minAmountOut) external"
];

async function main() {
    // ── Validate env vars ─────────────────────────────────────────────────
    const requiredEnv = ["RPC_URL", "PRIVATE_KEY", "LIQUIDATOR_CONTRACT_ADDRESS"];
    for (const key of requiredEnv) {
        if (!process.env[key]) {
            console.error(`Missing env var: ${key}. Copy .env.example to .env and fill it in.`);
            process.exit(1);
        }
    }

    // 1. Setup Provider
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

    // 2. Setup Wallet
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`Bot started. Wallet address: ${wallet.address}`);

    const balance = await provider.getBalance(wallet.address);
    console.log(`Wallet balance: ${ethers.formatEther(balance)} ETH`);

    // 3. Connect to our Liquidator Contract
    const liquidatorAddress = process.env.LIQUIDATOR_CONTRACT_ADDRESS;
    const liquidatorContract = new ethers.Contract(liquidatorAddress, LiquidatorABI, wallet);

    // 4. Listen to Blockchain State
    console.log("Listening for underwater positions...");

    // TODO: Implement the actual scanning loop:
    //   - Subscribe to new blocks
    //   - Query Aave's getUserAccountData for active borrowers
    //   - When healthFactor < 1e18, calculate profitability
    //   - Call executeLiquidation with proper params
    //
    // Example (uncomment and fill in real values):
    //
    // provider.on("block", async (blockNumber) => {
    //     console.log(`New block: ${blockNumber}`);
    //     // ... scan for underwater positions
    // });
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
