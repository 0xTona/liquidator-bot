# Aave Flash Loan Liquidator

A highly optimized, zero-capital liquidation bot designed to run on low-gas L2 networks (Base or Arbitrum). It uses **0-fee flash loans from Balancer** to liquidate underwater Aave positions, swaps the seized collateral on Uniswap V3, and keeps the profit.

If a liquidation is not profitable, the transaction **reverts automatically** — costing you nothing when paired with a private RPC.

## Architecture

```
┌─────────────────────┐         ┌──────────────────────────────────────┐
│  Off-Chain Bot       │         │  On-Chain: Liquidator.sol            │
│  (src/bot.js)        │         │                                      │
│                      │  tx     │  1. Request flash loan (Balancer)    │
│  - Monitor blocks    │────────▶│  2. Liquidate on Aave               │
│  - Calc health factor│         │  3. Swap collateral → debt (UniV3)  │
│  - Check profitability│        │  4. Repay flash loan (0 fee)        │
│  - Submit via private│         │  5. Profit check (revert if zero)   │
│    RPC (Flashbots)   │         │  6. Send profit to owner            │
└─────────────────────┘         └──────────────────────────────────────┘
```

### Smart Contract Features
- **Zero-fee flash loans** via Balancer Vault
- **Dynamic swap fee tier** — the bot picks the optimal Uniswap pool (0.01%, 0.05%, 0.3%, 1%)
- **Slippage protection** — `minAmountOut` is calculated off-chain and enforced on-chain
- **Reentrancy guard** on the flash loan callback
- **Rescue functions** to recover stuck tokens or ETH (`rescueTokens`, `rescueETH`)
- **Custom errors** for gas-efficient reverts (`NotOwner`, `NoProfitRevert`, etc.)
- **Immutable state** — constructor variables use `immutable` to save ~2,100 gas per read

### Off-Chain Bot Features
- Environment variable validation on startup
- Wallet balance display
- Extensible block listener for scanning Aave positions

---

## Setup Instructions for Debian Linux

### 1. Prerequisites
Ensure you have Node.js (v20+) installed on your Debian server:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Install Dependencies
Clone this repository and install packages:
```bash
git clone <your-repo-url>
cd liquidation-tool
npm install
```

### 3. Configure Environment Variables
Copy the example file and fill in your credentials:
```bash
cp .env.example .env
nano .env
```

The `.env` file requires three values:
```ini
# Your wallet private key (use a FRESH wallet with only $1 for gas!)
PRIVATE_KEY="0x_your_private_key_here"

# RPC URL for Base or Arbitrum (get a free one from https://www.alchemy.com)
RPC_URL="https://base-mainnet.g.alchemy.com/v2/YOUR_KEY"

# Deployed Liquidator contract address (fill after step 5)
LIQUIDATOR_CONTRACT_ADDRESS=""
```

> ⚠️ **Security**: Never commit your `.env` file. It is already in `.gitignore`.

### 4. Compile the Smart Contract
```bash
npx hardhat compile
```

### 5. Deploy the Smart Contract
Before deploying, update `scripts/deploy.js` with the correct contract addresses for your target network:

| Contract | Base | Arbitrum |
|----------|------|----------|
| Balancer Vault | `TBD` | `TBD` |
| Aave V4 Pool | `TBD` | `TBD` |
| Uniswap V3 Router | `TBD` | `TBD` |

Then deploy:
```bash
npx hardhat run scripts/deploy.js --network base
```
Copy the deployed contract address and add it to your `.env` as `LIQUIDATOR_CONTRACT_ADDRESS`.

### 6. Run the Bot

**Quick test:**
```bash
npm start
```

**Production (24/7 with auto-restart):**
```bash
sudo npm install -g pm2
pm2 start src/bot.js --name "aave-liquidator"
pm2 save
pm2 startup   # auto-start on server reboot
```

**Monitor logs:**
```bash
pm2 logs aave-liquidator
```

---

## How the $1 Gas Budget Works

The contract enforces `if (profit == 0) revert NoProfitRevert()` at the end of every liquidation. This means:

1. **Profitable liquidation** → transaction succeeds, you keep the profit minus gas (~$0.01 on L2).
2. **Unprofitable liquidation** → transaction reverts on-chain.

To avoid paying gas on reverts, send transactions through a **private RPC** (like [Flashbots](https://docs.flashbots.net/) or a network-specific builder). The builder simulates your transaction first — if it reverts, it is simply dropped. **You pay $0.00 for failed attempts.** Your $1 is only spent on winning liquidations.

---

## Contract Interface

The bot calls `executeLiquidation` with these parameters:

```solidity
function executeLiquidation(
    address collateralAsset,  // Token the borrower posted as collateral
    address debtAsset,        // Token the borrower owes
    address targetUser,       // The underwater borrower's address
    uint256 debtToCover,      // Amount of debt to repay
    uint24  swapFeeTier,      // Uniswap V3 fee tier (100, 500, 3000, or 10000)
    uint256 minAmountOut      // Minimum swap output (slippage protection)
) external onlyOwner
```

### Emergency Functions
```solidity
// Recover ERC20 tokens stuck in the contract
function rescueTokens(address token, uint256 amount) external onlyOwner

// Recover ETH stuck in the contract
function rescueETH() external onlyOwner
```

---

## Project Structure
```
liquidation-tool/
├── contracts/
│   └── Liquidator.sol    # Flash loan + liquidation + swap + profit check
├── src/
│   └── bot.js            # Off-chain monitoring and transaction submission
├── .env.example          # Template for required environment variables
├── .gitignore            # Excludes .env, node_modules, artifacts
├── hardhat.config.js     # Solidity compiler and network configuration
├── package.json          # Node.js dependencies
└── README.md             # This file
```
