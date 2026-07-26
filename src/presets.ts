import { AccountSnapshot } from "./types";

export const INITIAL_PRESETS: { [key: string]: { name: string; description: string; snapshot: AccountSnapshot } } = {
  breached: {
    name: "Breached Margin Call (Self-Check)",
    description: "Matches the worked example: $8,000 collateral value and $4,500 loan with a 50% LTV maintenance limit.",
    snapshot: {
      cash: 0,
      loan_balance: 4500,
      maintenance_ltv_limit: 0.50,
      holdings: [
        {
          id: "lot_xyz_1",
          symbol: "XYZ",
          quantity: 40,
          cost_basis: 220.00,
          acquired_date: "2026-07-10", // 11 days ago - wash sale candidate!
          current_price: 200.00,       // current_value = $8,000. Unrealized loss = -$800.
        }
      ]
    }
  },
  warning: {
    name: "Warning State (High LTV / Low Headroom)",
    description: "Account LTV is close to the 50% limit. Headroom is thin, showing elevated margin call risk.",
    snapshot: {
      cash: 1200,
      loan_balance: 42000,
      maintenance_ltv_limit: 0.50,
      holdings: [
        {
          id: "lot_aapl_1",
          symbol: "AAPL",
          quantity: 100,
          cost_basis: 210.00,
          acquired_date: "2026-07-05", // Loss lot, bought 16 days ago
          current_price: 180.00,       // Value: $18,000, loss: -$3,000
        },
        {
          id: "lot_aapl_2",
          symbol: "AAPL",
          quantity: 150,
          cost_basis: 150.00,
          acquired_date: "2026-02-15", // Gain lot
          current_price: 180.00,       // Value: $27,000, gain: +$4,500
        },
        {
          id: "lot_tsla_1",
          symbol: "TSLA",
          quantity: 100,
          cost_basis: 240.00,
          acquired_date: "2026-07-12", // Loss lot, bought 9 days ago
          current_price: 210.00,       // Value: $21,000, loss: -$3,000
        },
        {
          id: "lot_tsla_2",
          symbol: "TSLA",
          quantity: 110,
          cost_basis: 170.00,
          acquired_date: "2025-10-22", // Gain lot
          current_price: 210.00,       // Value: $23,100, gain: +$4,400
        }
      ]
    }
  },
  safe: {
    name: "Safe Growth Portfolio",
    description: "Well-diversified portfolio with low LTV leverage and healthy headroom across multiple blue-chip assets.",
    snapshot: {
      cash: 5000,
      loan_balance: 30000,
      maintenance_ltv_limit: 0.50,
      holdings: [
        {
          id: "lot_nvda_1",
          symbol: "NVDA",
          quantity: 400,
          cost_basis: 85.00,
          acquired_date: "2025-11-15",
          current_price: 125.00,       // Value: $50,000, gain: +$16,000
        },
        {
          id: "lot_amzn_1",
          symbol: "AMZN",
          quantity: 250,
          cost_basis: 195.00,
          acquired_date: "2026-07-02", // Loss lot, bought 19 days ago
          current_price: 180.00,       // Value: $45,000, loss: -$3,750
        },
        {
          id: "lot_msft_1",
          symbol: "MSFT",
          quantity: 100,
          cost_basis: 420.00,
          acquired_date: "2026-03-10",
          current_price: 440.00,       // Value: $44,000, gain: +$2,000
        }
      ]
    }
  }
};
