import { ethers } from "ethers";
import {
  AAVE_POOL_ABI,
  AAVE_DATA_PROVIDER_ABI,
  ERC20_ABI,
  HF_THRESHOLD,
} from "./config.js";

/**
 * Scanner — discovers borrowers from Aave events and checks their health factors.
 */
export class Scanner {
  /**
   * @param {ethers.Provider} provider
   * @param {object} networkConfig — from getNetworkConfig()
   */
  constructor(provider, networkConfig) {
    this.provider = provider;
    this.config = networkConfig;

    this.pool = new ethers.Contract(
      networkConfig.aavePool,
      AAVE_POOL_ABI,
      provider
    );
    this.dataProvider = new ethers.Contract(
      networkConfig.aaveDataProvider,
      AAVE_DATA_PROVIDER_ABI,
      provider
    );

    // Set of all known borrower addresses
    this.borrowers = new Set();

    // Cache: token address → { symbol, decimals }
    this.tokenCache = new Map();
  }

  /**
   * Build initial borrower set by scanning past Borrow events.
   * Also removes borrowers who have been fully liquidated.
   */
  async initialize() {
    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - this.config.eventLookbackBlocks);

    console.log(
      `Scanning Borrow events from block ${fromBlock} to ${currentBlock} ` +
      `(${this.config.eventLookbackBlocks.toLocaleString()} blocks)...`
    );

    // Start with a large chunk, automatically shrink if the RPC rejects it.
    // Free-tier RPCs often limit to 10 blocks; paid tiers allow 10k+.
    let chunkSize = 2000;
    let scanned = 0;

    for (let start = fromBlock; start <= currentBlock; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, currentBlock);

      try {
        const borrowEvents = await this.pool.queryFilter(
          this.pool.filters.Borrow(),
          start,
          end
        );

        for (const event of borrowEvents) {
          const borrower = event.args[1]; // 'user' field in Borrow event
          this.borrowers.add(borrower);
        }
      } catch (err) {
        // RPC rejected the range — halve the chunk size and retry this block
        if (chunkSize > 10) {
          chunkSize = Math.max(10, Math.floor(chunkSize / 2));
          console.warn(`  RPC limit hit, reducing chunk to ${chunkSize} blocks`);
          start -= chunkSize; // retry from same position
          continue;
        }
        // Already at minimum chunk, skip this range
        console.warn(`  Skipping blocks ${start}-${end}: ${err.message}`);
      }

      scanned += end - start + 1;
      if (scanned % 500 === 0 || scanned === (currentBlock - fromBlock + 1)) {
        process.stdout.write(
          `\r  Scanned ${scanned.toLocaleString()} / ${(currentBlock - fromBlock + 1).toLocaleString()} blocks | ${this.borrowers.size} borrowers`
        );
      }

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log(); // newline after progress

    console.log(`Initial scan complete. Tracking ${this.borrowers.size} borrowers.`);

    // Pre-cache the reserve list
    this.reserves = await this.pool.getReservesList();
    console.log(`Aave has ${this.reserves.length} active reserves.`);

    // Cache token metadata
    for (const reserve of this.reserves) {
      await this.cacheToken(reserve);
    }
  }

  /**
   * Listen for new Borrow events in real-time to track new borrowers.
   */
  startEventListener() {
    this.pool.on("Borrow", (_reserve, user) => {
      if (!this.borrowers.has(user)) {
        this.borrowers.add(user);
        console.log(`[+] New borrower tracked: ${user} (total: ${this.borrowers.size})`);
      }
    });

    this.pool.on("LiquidationCall", (_col, _debt, user) => {
      // Don't remove — they might still have remaining debt
      // We'll re-check their HF next scan
      console.log(`[!] Liquidation observed for ${user}`);
    });

    console.log("Real-time event listener started.");
  }

  /**
   * Check all borrowers' health factors and return the underwater ones.
   * @returns {Array<{user: string, totalCollateralBase: bigint, totalDebtBase: bigint, healthFactor: bigint}>}
   */
  async findUnderwaterPositions() {
    const underwater = [];
    const stale = []; // borrowers with 0 debt (fully repaid)

    // Process in batches to avoid overwhelming the RPC
    const BATCH_SIZE = 50;
    const borrowerArray = Array.from(this.borrowers);

    for (let i = 0; i < borrowerArray.length; i += BATCH_SIZE) {
      const batch = borrowerArray.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map((user) => this.pool.getUserAccountData(user))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const user = batch[j];

        if (result.status === "rejected") continue;

        const [totalCollateralBase, totalDebtBase, , , , healthFactor] = result.value;

        // Remove borrowers who have fully repaid
        if (totalDebtBase === 0n) {
          stale.push(user);
          continue;
        }

        // Check if underwater (HF < 1.0)
        if (healthFactor < HF_THRESHOLD) {
          underwater.push({
            user,
            totalCollateralBase,
            totalDebtBase,
            healthFactor,
          });
        }
      }
    }

    // Clean up stale borrowers
    for (const user of stale) {
      this.borrowers.delete(user);
    }

    return underwater;
  }

  /**
   * For an underwater user, find their specific collateral and debt positions.
   * Returns the most profitable pair (largest collateral + largest debt).
   *
   * @param {string} user
   * @returns {{ collateralAsset, collateralBalance, debtAsset, debtBalance, liquidationBonus, decimals }}
   */
  async analyzePosition(user) {
    let bestCollateral = null;
    let bestDebt = null;

    for (const reserve of this.reserves) {
      try {
        const [
          currentATokenBalance,
          currentStableDebt,
          currentVariableDebt,
          , , , , ,
          usageAsCollateralEnabled,
        ] = await this.dataProvider.getUserReserveData(reserve, user);

        const totalDebt = currentStableDebt + currentVariableDebt;

        // Track the largest collateral position
        if (currentATokenBalance > 0n && usageAsCollateralEnabled) {
          if (!bestCollateral || currentATokenBalance > bestCollateral.balance) {
            bestCollateral = { asset: reserve, balance: currentATokenBalance };
          }
        }

        // Track the largest debt position
        if (totalDebt > 0n) {
          if (!bestDebt || totalDebt > bestDebt.balance) {
            bestDebt = { asset: reserve, balance: totalDebt };
          }
        }
      } catch {
        // Skip reserves that fail
      }
    }

    if (!bestCollateral || !bestDebt) return null;

    // Get liquidation bonus for the collateral asset
    const [decimals, , , liquidationBonus] =
      await this.dataProvider.getReserveConfigurationData(bestCollateral.asset);

    const collateralToken = this.tokenCache.get(bestCollateral.asset);
    const debtToken = this.tokenCache.get(bestDebt.asset);

    return {
      collateralAsset: bestCollateral.asset,
      collateralBalance: bestCollateral.balance,
      collateralSymbol: collateralToken?.symbol || "???",
      debtAsset: bestDebt.asset,
      debtBalance: bestDebt.balance,
      debtSymbol: debtToken?.symbol || "???",
      debtDecimals: debtToken?.decimals || 18,
      liquidationBonus: Number(liquidationBonus), // e.g., 10500 = 5% bonus
      collateralDecimals: Number(decimals),
    };
  }

  /**
   * Cache token symbol and decimals.
   */
  async cacheToken(address) {
    if (this.tokenCache.has(address)) return;
    try {
      const token = new ethers.Contract(address, ERC20_ABI, this.provider);
      const [symbol, decimals] = await Promise.all([
        token.symbol(),
        token.decimals(),
      ]);
      this.tokenCache.set(address, { symbol, decimals: Number(decimals) });
    } catch {
      this.tokenCache.set(address, { symbol: "???", decimals: 18 });
    }
  }
}
