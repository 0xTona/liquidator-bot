// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IFlashLoanRecipient {
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external;
}

interface IVault {
    function flashLoan(
        IFlashLoanRecipient recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

interface IAavePool {
    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external;
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

// ──────────────────────────────────────────────────────────────────────────────
// Custom Errors (OPT-2: cheaper than string reverts)
// ──────────────────────────────────────────────────────────────────────────────
error NotOwner();
error OnlyBalancerVault();
error NoProfitRevert();
error Reentrancy();

contract Liquidator is IFlashLoanRecipient {
    // ──────────────────────────────────────────────────────────────────────────
    // OPT-1: immutable saves ~2,100 gas per read (CODECOPY vs SLOAD)
    // ──────────────────────────────────────────────────────────────────────────
    address public immutable owner;
    IVault public immutable balancerVault;
    IAavePool public immutable aavePool;
    ISwapRouter public immutable swapRouter;

    // BUG-4 FIX: Reentrancy guard
    uint256 private _locked = 1;

    constructor(address _balancerVault, address _aavePool, address _swapRouter) {
        owner = msg.sender;
        balancerVault = IVault(_balancerVault);
        aavePool = IAavePool(_aavePool);
        swapRouter = ISwapRouter(_swapRouter);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked == 2) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // BUG-5 FIX: Rescue stuck tokens / ETH
    // ──────────────────────────────────────────────────────────────────────────
    receive() external payable {}

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }

    function rescueETH() external onlyOwner {
        (bool ok, ) = owner.call{value: address(this).balance}("");
        require(ok);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 1. Off-chain bot calls this function
    //    BUG-3 FIX: fee tier is now a parameter, not hardcoded
    //    BUG-2 FIX: minAmountOut is passed from the off-chain bot
    // ──────────────────────────────────────────────────────────────────────────
    function executeLiquidation(
        address collateralAsset,
        address debtAsset,
        address targetUser,
        uint256 debtToCover,
        uint24 swapFeeTier,
        uint256 minAmountOut
    ) external onlyOwner {
        address[] memory tokens = new address[](1);
        tokens[0] = debtAsset;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = debtToCover;

        // Encode ALL parameters for the callback
        bytes memory userData = abi.encode(
            collateralAsset,
            debtAsset,
            targetUser,
            debtToCover,
            swapFeeTier,
            minAmountOut
        );

        // Request Flash Loan from Balancer (0 fee)
        balancerVault.flashLoan(this, tokens, amounts, userData);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Balancer calls this function with the borrowed funds
    // ──────────────────────────────────────────────────────────────────────────
    function receiveFlashLoan(
        address[] memory,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override nonReentrant {
        if (msg.sender != address(balancerVault)) revert OnlyBalancerVault();

        (
            address collateralAsset,
            address debtAsset,
            address targetUser,
            uint256 debtToCover,
            uint24 swapFeeTier,
            uint256 minAmountOut
        ) = abi.decode(userData, (address, address, address, uint256, uint24, uint256));

        // ── 3. Approve Aave & Liquidate ─────────────────────────────────────
        IERC20(debtAsset).approve(address(aavePool), debtToCover);
        aavePool.liquidationCall(
            collateralAsset,
            debtAsset,
            targetUser,
            debtToCover,
            false // receive underlying token, not aToken
        );

        // ── 4. Swap collateral → debtAsset (skip if same token) ─────────────
        // BUG-6 FIX: handle collateral == debt edge case
        if (collateralAsset != debtAsset) {
            uint256 collateralReceived = IERC20(collateralAsset).balanceOf(address(this));
            IERC20(collateralAsset).approve(address(swapRouter), collateralReceived);

            ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                tokenIn: collateralAsset,
                tokenOut: debtAsset,
                fee: swapFeeTier,          // BUG-3 FIX: dynamic fee tier
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: collateralReceived,
                amountOutMinimum: minAmountOut, // BUG-2 FIX: real slippage protection
                sqrtPriceLimitX96: 0
            });

            swapRouter.exactInputSingle(params);
        }

        // ── 5. Repay Balancer ───────────────────────────────────────────────
        uint256 amountToRepay = amounts[0] + feeAmounts[0]; // fee is 0 on Balancer
        IERC20(debtAsset).transfer(address(balancerVault), amountToRepay);

        // ── 6. Profitability Check ──────────────────────────────────────────
        // BUG-1 FIX: After repaying the flash loan, any remaining balance IS profit.
        // The old code compared against `initialDebtBalance` which INCLUDED the
        // flash loan amount, making this check always fail.
        uint256 profit = IERC20(debtAsset).balanceOf(address(this));
        if (profit == 0) revert NoProfitRevert();

        // ── 7. Send profit to owner ─────────────────────────────────────────
        IERC20(debtAsset).transfer(owner, profit);
    }
}
