# Portfolio Optimizer & Collateral Agent System Design & Architectural Guide

This document provides a comprehensive walkthrough of the **Portfolio Liquidity, Tax-Loss Harvesting, and Margin LTV System**. It covers the codebase file structure, core financial economics, potential system flaws, study guide, and the Python-based **LangGraph v1** agent architecture.

---

## 1. Codebase Directory & File Guide

### A. Web Application Architecture (React + Express + Zyloo)

*   **`/src/App.tsx`**: Main UI container for the Elegant Dark dashboard. Orchestrates real-time state for portfolio holdings, active loan balances, market stress test sliders, optimization proposals, and the AI advisor chat desk.
*   **`/src/types.ts`**: TypeScript definitions for `HoldingLot`, `AccountSnapshot`, `OptimizationProposal`, `ProposedTrade`, and `ChatMessage`. Ensures static type safety across client and API handlers.
*   **`/src/utils.ts`**: Pure mathematical calculations for Loan-to-Value ratios, borrowing headroom, market crash shock simulations, and tax-loss harvesting lot selection algorithms.
*   **`/src/presets.ts`**: Pre-configured scenario presets (*Standard Baseline*, *Margin Call Stress Test*, *Tax-Harvesting Opportunity*, *Conservative Asset Mix*) for instant sandbox testing.
*   **`/src/components/HoldingsTable.tsx`**: Interactive asset tax lot manager allowing CRUD operations for tax lots (Symbol, Quantity, Cost Basis, Current Price, Purchase Date) with live unrealized gain/loss tracking.
*   **`/src/components/OptimizationProposal.tsx`**: LTV metric gauge, headroom deficit alert banner, pro-forma rebalancing proposals, and the compliance approval step.
*   **`/src/components/ChatAssistant.tsx`**: Interactive AI advisor desk interface enabling what-if queries, strategy explanations, and tax planning suggestions via Zyloo API.
*   **`/server.ts`**: Express backend proxying client requests to the Zyloo API (`api.zyloo.io/v1`), keeping API keys safe on the server side.

### B. Python LangGraph Agent Architecture (KISS v1)

*   **`/agent.py`**: Constructs and compiles the linear `StateGraph` linking all 6 processing nodes with checkpointer memory support.
*   **`/nodes.py`**: Modular Python class implementations for the 6 core nodes:
    1.  `IngestPortfolioNode`: Ingests and normalizes multi-account portfolio JSON into `state["account"]`.
    2.  `LTVMonitorNode`: Computes `collateral_value`, `current_ltv`, `headroom`, and `risk_state` ("Safe", "Warning", "High Risk").
    3.  `TaxOptimizerNode`: Ranks asset lots by unrealized gain/loss (largest losses first for tax-loss harvesting).
    4.  `ReasoningAgentNode`: Synthesizes LTV metrics and ranked lots into a structured recommendation (uses Zyloo/OpenRouter/Poolside via `init_chat_model` or structured fallback).
    5.  `HumanApprovalNode`: Pauses graph execution via `interrupt()` to require human supervisor authorization.
    6.  `ExecutionNode`: Logs the final trade action ("would execute" or "rejected") upon human approval.
*   **`/fixtures/fake_users.json`**: Synthetic test dataset containing 4 account scenarios (*Safe*, *Warning*, *High Risk Breached*, and *Mixed Tax Lots*).
*   **`/run_fixtures.py`**: Test harness verifying all 4 fixtures against the Definition of Done (e.g. headroom == -$500.00 for High Risk, loss lot ranked first for Mixed Lots, pause before execution).

---

## 2. Financial Economics & Core Formulas

### 1. Loan-to-Value (LTV) Ratio
$$LTV = \frac{\text{Net Debt}}{\text{Collateral Value}} = \frac{\text{Loan Balance} - \text{Cash}}{\sum (\text{Quantity}_i \times \text{Current Price}_i)}$$

### 2. Borrowing Headroom
$$\text{Headroom} = (\text{Collateral Value} \times \text{Maintenance LTV Limit}) - \text{Net Debt}$$

*   **Headroom $> 0$**: The account has excess borrowing capacity.
*   **Headroom $< 0$**: The account is in a **Margin Deficit** and risks liquidation.

### 3. Risk Classification Thresholds
Let $R = \frac{\text{Headroom}}{\text{Max Loan Allowed}}$.
*   **High Risk**: $\text{Headroom} < 0$ (Breached / Margin Deficit)
*   **Warning**: $0 \le R < 0.25$ (Low buffer against market volatility)
*   **Safe**: $R \ge 0.25$ (Healthy cushion)

### 4. Tax-Loss Harvesting (TLH) Ranking
$$\text{Unrealized Gain/Loss}_i = (\text{Current Price}_i - \text{Cost Basis}_i) \times \text{Quantity}_i$$
Lots are sorted in ascending order of unrealized gain/loss ($-\$3,000$ loss comes before $+\$2,500$ gain) to maximize capital loss offsets against realized taxable gains.

---

## 3. System Design Flaws & Edge Cases to Study

1.  **Proceeds-to-Debt Shrinking Collateral Feedback Loop**:
    When selling collateral stock to pay down debt, collateral value decreases at the same time. Paying down $\$1,000$ of debt by liquidating $\$1,000$ of stock only improves headroom by $\$1,000 \times (1 - \text{Maintenance LTV Limit})$.
    *Correct Sizing Formula*:
    $$\text{Liquidation Required} = \frac{\text{Deficit}}{1 - \text{Maintenance LTV Limit}}$$

2.  **IRS Wash-Sale Rule (IRC Section 1091)**:
    If a security is sold at a loss and a "substantially identical" security is purchased within 30 days before or after the sale, the tax loss is disallowed and added to the cost basis of the new position.

3.  **Market Execution Slippage & T+1 Settlement**:
    Real market orders experience price slippage during liquidations. In a flash crash, prices may drop further between order routing and execution settlement.

---

## 4. Online Study Guide & Topics to Research

1.  **Reg T vs. Portfolio Margin**: Standard Regulation T margin (50% initial, 25% maintenance) vs. risk-based Portfolio Margin (TIMS option pricing risk models).
2.  **IRC Section 1091 (Wash Sales)**: Rules governing tax loss disallowances across personal, IRA, and spousal accounts.
3.  **LangGraph State Management & Interrupts**: Building human-in-the-loop agent workflows using state checkpointers (`MemorySaver`) and `interrupt()`.
4.  **Structured JSON Generation with Zyloo**: Using `init_chat_model` with OpenAI-compatible API (`api.zyloo.io/v1`) and strict Pydantic schemas to ensure LLM outputs return parseable JSON.
