// ──────────────────────────────────────────────────────────────────────────────
// Network configuration and contract addresses
// ──────────────────────────────────────────────────────────────────────────────

// Aave V3 Pool ABI (human-readable, ethers v6)
export const AAVE_POOL_ABI = [
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "function getReservesList() view returns (address[])",
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
  "event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)",
  "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)",
];

// Aave PoolDataProvider ABI
export const AAVE_DATA_PROVIDER_ABI = [
  "function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)",
  "function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)",
];

// ERC20 minimal ABI
export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

// Uniswap V3 QuoterV2 ABI
export const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

// Liquidator contract ABI
export const LIQUIDATOR_ABI = [
  "function executeLiquidation(address collateralAsset, address debtAsset, address targetUser, uint256 debtToCover, uint24 swapFeeTier, uint256 minAmountOut) external",
];

// ──────────────────────────────────────────────────────────────────────────────
// Per-network addresses
// ──────────────────────────────────────────────────────────────────────────────
const NETWORKS = {
  // Base Mainnet (chainId 8453)
  8453: {
    name: "Base",
    aavePool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    aaveDataProvider: "0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac",
    uniswapQuoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    uniswapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481",
    // How far back to scan for Borrow events on first startup
    // Keep this low for free-tier RPCs. Real-time listener covers new events.
    eventLookbackBlocks: 2_000,
    // How often to check health factors (in blocks, Base = 2s/block)
    scanIntervalBlocks: 5,
  },
  // Arbitrum One (chainId 42161)
  42161: {
    name: "Arbitrum",
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    aaveDataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
    uniswapQuoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    eventLookbackBlocks: 5_000,
    scanIntervalBlocks: 10,
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Liquidation parameters
// ──────────────────────────────────────────────────────────────────────────────

// Aave lets you liquidate up to 50% of a user's debt (close factor)
export const CLOSE_FACTOR = 0.5;

// Health factor threshold (1.0 in 18-decimal format)
export const HF_THRESHOLD = BigInt("1000000000000000000"); // 1e18

// Minimum profit in USD (base currency has 8 decimals on Aave)
// $0.50 minimum profit to cover gas
export const MIN_PROFIT_BASE = BigInt("50000000"); // 0.5 USD in 8 decimals

// Uniswap fee tiers to try (in order of preference)
export const FEE_TIERS = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

// Slippage tolerance (0.5%)
export const SLIPPAGE_BPS = 50;

/**
 * Get network config by chainId
 */
export function getNetworkConfig(chainId) {
  const config = NETWORKS[Number(chainId)];
  if (!config) {
    throw new Error(
      `Unsupported chainId: ${chainId}. Supported: ${Object.keys(NETWORKS).join(", ")}`
    );
  }
  return config;
}
