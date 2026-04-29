import { ethers } from "ethers";
import {
  LIQUIDATOR_ABI,
  QUOTER_ABI,
  CLOSE_FACTOR,
  FEE_TIERS,
  SLIPPAGE_BPS,
  MIN_PROFIT_BASE,
} from "./config.js";

/**
 * Liquidator — calculates profitability and executes on-chain liquidations.
 */
export class Liquidator {
  /**
   * @param {ethers.Wallet} wallet
   * @param {object} networkConfig
   * @param {string} liquidatorAddress — deployed Liquidator.sol address
   */
  constructor(wallet, networkConfig, liquidatorAddress) {
    this.wallet = wallet;
    this.config = networkConfig;

    this.contract = new ethers.Contract(
      liquidatorAddress,
      LIQUIDATOR_ABI,
      wallet
    );

    this.quoter = new ethers.Contract(
      networkConfig.uniswapQuoter,
      QUOTER_ABI,
      wallet.provider
    );
  }

  /**
   * Attempt to liquidate an underwater position.
   *
   * @param {string} user — the underwater borrower
   * @param {object} position — from scanner.analyzePosition()
   * @returns {{ success: boolean, txHash?: string, profit?: string, reason?: string }}
   */
  async tryLiquidate(user, position) {
    const {
      collateralAsset,
      collateralSymbol,
      debtAsset,
      debtBalance,
      debtSymbol,
      debtDecimals,
      liquidationBonus,
    } = position;

    // ── 1. Calculate debt to cover (close factor = 50%) ──────────────────
    const debtToCover = (debtBalance * BigInt(Math.floor(CLOSE_FACTOR * 100))) / 100n;

    if (debtToCover === 0n) {
      return { success: false, reason: "Debt too small" };
    }

    // ── 2. Find the best Uniswap fee tier ────────────────────────────────
    // Skip quote if collateral == debt (no swap needed)
    let bestFeeTier = 3000;
    let expectedAmountOut = debtToCover; // if same token, output = input

    if (collateralAsset.toLowerCase() !== debtAsset.toLowerCase()) {
      // Estimate collateral we'd receive (debt * bonus)
      // liquidationBonus is in basis points, e.g., 10500 = 105% = 5% bonus
      const bonusMultiplier = BigInt(liquidationBonus);
      const estimatedCollateral = (debtToCover * bonusMultiplier) / 10000n;

      const quoteResult = await this.findBestFeeTier(
        collateralAsset,
        debtAsset,
        estimatedCollateral
      );

      if (!quoteResult) {
        return { success: false, reason: "No Uniswap liquidity for this pair" };
      }

      bestFeeTier = quoteResult.feeTier;
      expectedAmountOut = quoteResult.amountOut;
    }

    // ── 3. Profitability check (off-chain simulation) ────────────────────
    // Profit = swap output - debt repaid
    const estimatedProfit = expectedAmountOut - debtToCover;

    if (estimatedProfit <= 0n) {
      return {
        success: false,
        reason: `Unprofitable: swap output ${ethers.formatUnits(expectedAmountOut, debtDecimals)} < debt ${ethers.formatUnits(debtToCover, debtDecimals)} ${debtSymbol}`,
      };
    }

    // ── 4. Calculate minAmountOut with slippage ──────────────────────────
    // minAmountOut = expectedAmountOut * (1 - slippage)
    const minAmountOut =
      (expectedAmountOut * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;

    // ── 5. Estimate gas to make sure we can afford it ────────────────────
    let gasEstimate;
    try {
      gasEstimate = await this.contract.executeLiquidation.estimateGas(
        collateralAsset,
        debtAsset,
        user,
        debtToCover,
        bestFeeTier,
        minAmountOut
      );
    } catch (err) {
      return {
        success: false,
        reason: `Gas estimation failed (would revert): ${err.shortMessage || err.message}`,
      };
    }

    const feeData = await this.wallet.provider.getFeeData();
    const gasCost = gasEstimate * (feeData.gasPrice || 0n);

    console.log(
      `  Liquidating ${user}:\n` +
      `    Collateral: ${collateralSymbol} | Debt: ${ethers.formatUnits(debtToCover, debtDecimals)} ${debtSymbol}\n` +
      `    Expected profit: ${ethers.formatUnits(estimatedProfit, debtDecimals)} ${debtSymbol}\n` +
      `    Gas cost: ${ethers.formatEther(gasCost)} ETH\n` +
      `    Fee tier: ${bestFeeTier / 10000}%`
    );

    // ── 6. Send transaction ──────────────────────────────────────────────
    try {
      const tx = await this.contract.executeLiquidation(
        collateralAsset,
        debtAsset,
        user,
        debtToCover,
        bestFeeTier,
        minAmountOut,
        {
          gasLimit: (gasEstimate * 120n) / 100n, // 20% buffer
        }
      );

      console.log(`  ✅ TX sent: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`  ✅ Confirmed in block ${receipt.blockNumber}`);

      return {
        success: true,
        txHash: tx.hash,
        profit: ethers.formatUnits(estimatedProfit, debtDecimals),
      };
    } catch (err) {
      return {
        success: false,
        reason: `TX reverted: ${err.shortMessage || err.message}`,
      };
    }
  }

  /**
   * Try all Uniswap fee tiers and return the one with the best output.
   *
   * @param {string} tokenIn — collateral token
   * @param {string} tokenOut — debt token
   * @param {bigint} amountIn — estimated collateral amount
   * @returns {{ feeTier: number, amountOut: bigint } | null}
   */
  async findBestFeeTier(tokenIn, tokenOut, amountIn) {
    let best = null;

    for (const fee of FEE_TIERS) {
      try {
        const params = {
          tokenIn,
          tokenOut,
          amountIn,
          fee,
          sqrtPriceLimitX96: 0n,
        };

        const [amountOut] = await this.quoter.quoteExactInputSingle.staticCall(params);

        if (!best || amountOut > best.amountOut) {
          best = { feeTier: fee, amountOut };
        }
      } catch {
        // Pool doesn't exist for this fee tier, skip
      }
    }

    return best;
  }
}
