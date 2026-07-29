import { AccountSnapshot, ProposalOutput, ProposedLot, MarketEvent, HoldingLot } from "./types";

const SECTOR_MAP: { [symbol: string]: string } = {
  AAPL: "Technology", MSFT: "Technology", GOOGL: "Technology", GOOG: "Technology",
  META: "Technology", NVDA: "Technology", AMD: "Technology", INTC: "Technology",
  CRM: "Technology", ORCL: "Technology", ADBE: "Technology", SNOW: "Technology",
  PLTR: "Technology", UBER: "Technology", SQ: "Technology", SHOP: "Technology",
  AMZN: "Consumer Discretionary", TSLA: "Consumer Discretionary",
  HD: "Consumer Discretionary", NKE: "Consumer Discretionary",
  MCD: "Consumer Discretionary", SBUX: "Consumer Discretionary",
  JPM: "Financials", BAC: "Financials", WFC: "Financials", GS: "Financials",
  MS: "Financials", V: "Financials", MA: "Financials", AXP: "Financials",
  JNJ: "Healthcare", UNH: "Healthcare", PFE: "Healthcare", ABBV: "Healthcare",
  MRK: "Healthcare", LLY: "Healthcare", TMO: "Healthcare", ABT: "Healthcare",
  XOM: "Energy", CVX: "Energy", COP: "Energy", SLB: "Energy", EOG: "Energy",
  PG: "Consumer Staples", KO: "Consumer Staples", PEP: "Consumer Staples",
  COST: "Consumer Staples", WMT: "Consumer Staples",
  NEE: "Utilities", DUK: "Utilities", SO: "Utilities", D: "Utilities",
  AMT: "Real Estate", PLD: "Real Estate", CCI: "Real Estate", SPG: "Real Estate",
  CAT: "Industrials", BA: "Industrials", HON: "Industrials", UPS: "Industrials",
  GE: "Industrials", RTX: "Industrials", LMT: "Industrials",
  NFLX: "Communication Services", DIS: "Communication Services",
  CMCSA: "Communication Services", T: "Communication Services",
  VZ: "Communication Services",
};

function getDaysHeld(acquiredDate: string): number {
  const acquired = new Date(acquiredDate);
  const now = new Date();
  return Math.ceil((now.getTime() - acquired.getTime()) / (1000 * 60 * 60 * 24));
}

export function getAdjustedSnapshot(snapshot: AccountSnapshot, event?: MarketEvent): AccountSnapshot {
  if (!event) return snapshot;

  const adjustedHoldings = snapshot.holdings.map((lot) => {
    let price = lot.current_price;
    if (event.price_adjustments && event.price_adjustments[lot.symbol] !== undefined) {
      price = price * (1 + event.price_adjustments[lot.symbol]);
    } else if (event.global_adjustment !== undefined) {
      price = price * (1 + event.global_adjustment);
    }
    return {
      ...lot,
      current_price: Math.max(0, parseFloat(price.toFixed(4))),
    };
  });

  return {
    ...snapshot,
    holdings: adjustedHoldings,
  };
}

export function getDayDifference(dateStr1: string, dateStr2: string): number {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  const diffTime = Math.abs(d1.getTime() - d2.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function calculateOptimizer(
  rawSnapshot: AccountSnapshot,
  cashNeed: number = 0,
  marketEvent?: MarketEvent
): ProposalOutput {
  // Apply any market event price adjustments
  const snapshot = getAdjustedSnapshot(rawSnapshot, marketEvent);

  const { holdings, loan_balance, maintenance_ltv_limit } = snapshot;

  // 1. collateral_value = sum(quantity * current_price)
  let collateral_value = 0;
  holdings.forEach((lot) => {
    collateral_value += lot.quantity * lot.current_price;
  });
  collateral_value = parseFloat(collateral_value.toFixed(2));

  // 2. current_ltv = loan_balance / collateral_value
  const current_ltv = collateral_value > 0 ? parseFloat((loan_balance / collateral_value).toFixed(4)) : 0;

  // 3. max_loan_allowed = collateral_value * maintenance_ltv_limit
  const max_loan_allowed = parseFloat((collateral_value * maintenance_ltv_limit).toFixed(2));

  // 4. headroom = max_loan_allowed - loan_balance
  const headroom = parseFloat((max_loan_allowed - loan_balance).toFixed(2));

  // 5. Check risk state
  let risk_state: "Safe" | "Warning" | "High Risk" = "Safe";
  let risk_reasoning = "";

  const headroomRatio = max_loan_allowed > 0 ? headroom / max_loan_allowed : -1;

  if (headroom < 0) {
    risk_state = "High Risk";
    risk_reasoning = `Maintenance LTV limit of ${(maintenance_ltv_limit * 100).toFixed(0)}% is already breached. Negative headroom of $${Math.abs(headroom).toLocaleString()} requires immediate liquidation of collateral to restore account health.`;
  } else if (headroomRatio < 0.25) {
    risk_state = "Warning";
    risk_reasoning = `Headroom of $${headroom.toLocaleString()} is thin (less than 25% of max loan allowed). Risk of margin call is elevated.`;
  } else {
    risk_state = "Safe";
    risk_reasoning = `Account LTV is healthy with $${headroom.toLocaleString()} in borrowing headroom.`;
  }

  // If a market event pushes headroom below zero, escalate to High Risk
  if (marketEvent && risk_state !== "High Risk" && headroom < 0) {
    risk_state = "High Risk";
    risk_reasoning = `Market Event "${marketEvent.description}" caused margin breach. Headroom is now $${headroom.toLocaleString()} (Current LTV: ${(current_ltv * 100).toFixed(1)}%).`;
  }

  // Determine shortfall
  const shortfall = headroom < 0 ? Math.abs(headroom) : 0;

  // Determine proceeds needed to pay down the loan to restore headroom to 0 after withdrawing cashNeed
  // Formula:
  // H_proforma = headroom - cashNeed * limit
  // If H_proforma < 0, we need paydown proceeds P_paydown = -H_proforma / (1 - limit)
  const h_proforma = headroom - cashNeed * maintenance_ltv_limit;
  let paydown_needed = 0;
  if (h_proforma < 0) {
    paydown_needed = Math.abs(h_proforma) / (1 - maintenance_ltv_limit);
  }

  const total_proceeds_needed = paydown_needed + cashNeed;

  // Rank candidate lots by unrealized_gain_loss ascending (most negative first)
  // For each lot: unrealized_gain_loss = (current_price - cost_basis) * quantity
  interface LotWithGainLoss extends HoldingLot {
    unrealized_gain_loss: number;
    gain_loss_per_share: number;
    days_held: number;
    is_short_term: boolean;
  }

  const lotsWithGainLoss: LotWithGainLoss[] = holdings.map((lot) => {
    const unrealized = (lot.current_price - lot.cost_basis) * lot.quantity;
    const daysHeld = getDaysHeld(lot.acquired_date);
    return {
      ...lot,
      unrealized_gain_loss: parseFloat(unrealized.toFixed(2)),
      gain_loss_per_share: lot.current_price - lot.cost_basis,
      days_held: daysHeld,
      is_short_term: daysHeld <= 365,
    };
  });

  // Sort: larger losses (most negative) first.
  lotsWithGainLoss.sort((a, b) => a.unrealized_gain_loss - b.unrealized_gain_loss);

  // Sector concentration analysis
  const sectorValues: { [sector: string]: number } = {};
  let totalValue = 0;
  holdings.forEach((lot) => {
    const value = lot.quantity * lot.current_price;
    totalValue += value;
    const sector = SECTOR_MAP[lot.symbol.toUpperCase()] || "Unknown";
    sectorValues[sector] = (sectorValues[sector] || 0) + value;
  });

  const sectorConcentration: { [sector: string]: number } = {};
  for (const [sector, value] of Object.entries(sectorValues)) {
    sectorConcentration[sector] = totalValue > 0 ? value / totalValue : 0;
  }

  const concentrationThreshold = 0.40;
  let concentrationWarning: string | null = null;
  for (const [sector, pct] of Object.entries(sectorConcentration)) {
    if (pct > concentrationThreshold) {
      concentrationWarning = `Sector '${sector}' represents ${(pct * 100).toFixed(0)}% of portfolio (threshold: ${(concentrationThreshold * 100).toFixed(0)}%). Consider diversifying to reduce concentration risk.`;
      break;
    }
  }

  // Propose lots to sell
  const proposed_lots_to_sell: ProposedLot[] = [];
  let remaining_target = total_proceeds_needed;
  let total_est_proceeds = 0;
  let total_realized_gain_loss = 0;

  for (const lot of lotsWithGainLoss) {
    if (remaining_target <= 0.01) break;

    const lot_value = lot.quantity * lot.current_price;
    const is_loss_lot = lot.current_price < lot.cost_basis;

    // Check wash sale risk: another lot of same symbol acquired within 30 days
    let wash_sale_caution = false;
    if (is_loss_lot) {
      wash_sale_caution = holdings.some((otherLot) => {
        return (
          otherLot.id !== lot.id &&
          otherLot.symbol === lot.symbol &&
          getDayDifference(lot.acquired_date, otherLot.acquired_date) <= 30
        );
      });
    }

    if (lot_value <= remaining_target) {
      // Sell whole lot
      proposed_lots_to_sell.push({
        lot_id: lot.id,
        symbol: lot.symbol,
        quantity: lot.quantity,
        est_proceeds: parseFloat(lot_value.toFixed(2)),
        realized_gain_loss: lot.unrealized_gain_loss,
        wash_sale_caution,
        is_short_term: lot.is_short_term,
        days_held: lot.days_held,
      });
      total_est_proceeds += lot_value;
      total_realized_gain_loss += lot.unrealized_gain_loss;
      remaining_target -= lot_value;
    } else {
      // Sell fractional lot
      const qty_to_sell = remaining_target / lot.current_price;
      const rounded_qty = parseFloat(qty_to_sell.toFixed(4));
      const est_proc = parseFloat((rounded_qty * lot.current_price).toFixed(2));
      const realized_gl = parseFloat((rounded_qty * lot.gain_loss_per_share).toFixed(2));

      proposed_lots_to_sell.push({
        lot_id: lot.id,
        symbol: lot.symbol,
        quantity: rounded_qty,
        est_proceeds: est_proc,
        realized_gain_loss: realized_gl,
        wash_sale_caution,
        is_short_term: lot.is_short_term,
        days_held: lot.days_held,
      });
      total_est_proceeds += est_proc;
      total_realized_gain_loss += realized_gl;
      remaining_target = 0;
    }
  }

  // Calculate resulting LTV
  // If we executed, we pay down the loan by the paydown portion of our proceeds, and the rest goes to the cash need.
  // Wait, if we can't meet the full target, the proceeds we got are first used to pay down the loan (critical to restore health), or proportional?
  // Let's assume all proceeds up to paydown_needed are used to pay down the loan.
  const actual_loan_paydown = Math.min(paydown_needed, total_est_proceeds);
  const remaining_proceeds_for_cash = Math.max(0, total_est_proceeds - actual_loan_paydown);

  const resulting_loan = parseFloat((loan_balance - actual_loan_paydown).toFixed(2));
  const resulting_collateral = parseFloat((collateral_value - total_est_proceeds).toFixed(2));
  const resulting_ltv_if_executed =
    resulting_collateral > 0 ? parseFloat((resulting_loan / resulting_collateral).toFixed(4)) : 0;

  // Build recommended action
  let recommended_action: "none" | "post_more_collateral" | "sell_lots" | "mixed" = "none";
  const isShort = remaining_target > 0.01;
  if (proposed_lots_to_sell.length > 0 && !isShort) {
    recommended_action = "sell_lots";
  } else if (proposed_lots_to_sell.length > 0 && isShort) {
    recommended_action = "mixed"; // sold everything available, still short — needs more collateral too
  } else if (shortfall > 0 && proposed_lots_to_sell.length === 0) {
    recommended_action = "post_more_collateral"; // no sellable lots at all
  }

  // Build rationale explanation
  let rationale = "";
  if (shortfall > 0) {
    const isShort = remaining_target > 0.01;
    rationale = `Account is in an active margin call with a $${shortfall.toLocaleString()} LTV shortfall. We recommend selling ${proposed_lots_to_sell.length} lot(s) to generate $${total_est_proceeds.toLocaleString()} in proceeds. ${isShort ? `Note: Selling all available assets is insufficient; you are still short $${remaining_target.toLocaleString()} to fully clear the breach and meet the cash need.` : `This paydown will reduce the loan to $${resulting_loan.toLocaleString()} and restore headroom to $0.`} We prioritized tax-loss harvesting by selecting lots with the largest unrealized losses first (realizing $${Math.abs(total_realized_gain_loss).toLocaleString()} in capital losses to minimize tax impact).`;
  } else if (cashNeed > 0) {
    const isShort = remaining_target > 0.01;
    rationale = `Proposing trade(s) to raise $${cashNeed.toLocaleString()} in requested liquidity. We selected the most tax-efficient lots first, harvesting $${Math.abs(total_realized_gain_loss).toLocaleString()} in capital losses. ${isShort ? `We were only able to raise $${total_est_proceeds.toLocaleString()}; you remain short $${remaining_target.toLocaleString()}.` : `After withdrawal, the resulting LTV will be ${(resulting_ltv_if_executed * 100).toFixed(1)}%, remaining within safe levels.`}`;
  } else {
    rationale = `Your portfolio is in a safe state with a current LTV of ${(current_ltv * 100).toFixed(1)}% and $${headroom.toLocaleString()} in headroom. No immediate liquidations or adjustments are required.`;
  }

  // Short-term vs long-term loss totals
  let shortTermLossTotal = 0;
  let longTermLossTotal = 0;
  proposed_lots_to_sell.forEach((lot) => {
    if (lot.realized_gain_loss < 0) {
      if (lot.is_short_term) {
        shortTermLossTotal += Math.abs(lot.realized_gain_loss);
      } else {
        longTermLossTotal += Math.abs(lot.realized_gain_loss);
      }
    }
  });

  return {
    risk_state,
    current_ltv,
    headroom_dollars: headroom,
    recommended_action,
    proposed_lots_to_sell,
    resulting_ltv_if_executed,
    rationale,
    sector_concentration: sectorConcentration,
    concentration_warning: concentrationWarning,
    short_term_loss_total: parseFloat(shortTermLossTotal.toFixed(2)),
    long_term_loss_total: parseFloat(longTermLossTotal.toFixed(2)),
  };
}
