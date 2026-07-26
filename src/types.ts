export interface HoldingLot {
  id: string;
  symbol: string;
  quantity: number;
  cost_basis: number; // per share
  acquired_date: string; // YYYY-MM-DD
  current_price: number; // per share
}

export interface AccountSnapshot {
  cash: number;
  loan_balance: number;
  maintenance_ltv_limit: number; // e.g. 0.50
  holdings: HoldingLot[];
}

export interface MarketEvent {
  description: string;
  global_adjustment?: number; // e.g. -0.20 for -20%
  price_adjustments?: { [symbol: string]: number }; // percentage change per symbol
}

export interface ProposedLot {
  lot_id: string;
  symbol: string;
  quantity: number;
  est_proceeds: number;
  realized_gain_loss: number;
  wash_sale_caution: boolean;
}

export interface ProposalOutput {
  risk_state: "Safe" | "Warning" | "High Risk";
  current_ltv: number;
  headroom_dollars: number;
  recommended_action: "none" | "post_more_collateral" | "sell_lots" | "mixed";
  proposed_lots_to_sell: ProposedLot[];
  resulting_ltv_if_executed: number;
  rationale: string;
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}
