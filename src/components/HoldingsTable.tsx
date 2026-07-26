import React, { useState } from "react";
import { HoldingLot, ProposedLot } from "../types";
import { Trash2, Plus, Calendar, Coins, ShieldAlert, Edit2, Check, X } from "lucide-react";

interface HoldingsTableProps {
  holdings: HoldingLot[];
  proposedLots: ProposedLot[];
  onUpdateHoldings: (newHoldings: HoldingLot[]) => void;
}

export default function HoldingsTable({ holdings, proposedLots, onUpdateHoldings }: HoldingsTableProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form states for new/editing lots
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [acquiredDate, setAcquiredDate] = useState("2026-07-10");
  const [currentPrice, setCurrentPrice] = useState("");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol || !quantity || !costBasis || !currentPrice) return;

    const newLot: HoldingLot = {
      id: "lot_" + Math.random().toString(36).substr(2, 9),
      symbol: symbol.toUpperCase(),
      quantity: parseFloat(quantity),
      cost_basis: parseFloat(costBasis),
      acquired_date: acquiredDate,
      current_price: parseFloat(currentPrice),
    };

    onUpdateHoldings([...holdings, newLot]);
    setIsAdding(false);
    resetForm();
  };

  const handleEditStart = (lot: HoldingLot) => {
    setEditingId(lot.id);
    setSymbol(lot.symbol);
    setQuantity(lot.quantity.toString());
    setCostBasis(lot.cost_basis.toString());
    setAcquiredDate(lot.acquired_date);
    setCurrentPrice(lot.current_price.toString());
  };

  const handleEditSave = (id: string) => {
    const updated = holdings.map((lot) => {
      if (lot.id === id) {
        return {
          ...lot,
          symbol: symbol.toUpperCase(),
          quantity: parseFloat(quantity) || lot.quantity,
          cost_basis: parseFloat(costBasis) || lot.cost_basis,
          acquired_date: acquiredDate || lot.acquired_date,
          current_price: parseFloat(currentPrice) || lot.current_price,
        };
      }
      return lot;
    });
    onUpdateHoldings(updated);
    setEditingId(null);
    resetForm();
  };

  const handleDelete = (id: string) => {
    onUpdateHoldings(holdings.filter((h) => h.id !== id));
  };

  const resetForm = () => {
    setSymbol("");
    setQuantity("");
    setCostBasis("");
    setAcquiredDate("2026-07-10");
    setCurrentPrice("");
  };

  // Helper to check if a lot is being proposed for sale and get proposed quantity/proceeds
  const getProposalDetails = (lotId: string) => {
    return proposedLots.find((p) => p.lot_id === lotId);
  };

  return (
    <div id="holdings-container" className="bg-[#111113] border border-white/10 rounded-2xl p-6 shadow-xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="font-sans font-medium text-base text-white">Portfolio Asset Lots</h3>
          <p className="text-xs text-white/40 font-mono mt-1">Detailed asset tracking sorted by purchase date & tax lots</p>
        </div>
        <button
          id="btn-add-lot"
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-2 px-3 py-1.5 bg-white text-black rounded-lg hover:bg-white/90 text-xs font-semibold tracking-tight transition cursor-pointer"
        >
          {isAdding ? <X size={14} /> : <Plus size={14} />}
          {isAdding ? "Cancel" : "Add Tax Lot"}
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-[#161618] border border-white/10 rounded-xl p-4 mb-6 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Symbol</label>
            <input
              type="text"
              placeholder="e.g. AAPL"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full text-xs bg-[#111113] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Qty</label>
            <input
              type="number"
              step="any"
              placeholder="10"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full text-xs bg-[#111113] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Cost Basis ($)</label>
            <input
              type="number"
              step="any"
              placeholder="200.00"
              value={costBasis}
              onChange={(e) => setCostBasis(e.target.value)}
              className="w-full text-xs bg-[#111113] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Acquired Date</label>
            <input
              type="date"
              value={acquiredDate}
              onChange={(e) => setAcquiredDate(e.target.value)}
              className="w-full text-xs bg-[#111113] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono text-white/80"
              required
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Current Price ($)</label>
              <input
                type="number"
                step="any"
                placeholder="180.00"
                value={currentPrice}
                onChange={(e) => setCurrentPrice(e.target.value)}
                className="w-full text-xs bg-[#111113] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
                required
              />
            </div>
            <button
              type="submit"
              className="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition h-[38px] flex items-center justify-center cursor-pointer"
            >
              <Check size={16} />
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/10 text-left text-[10px] uppercase text-white/40 font-mono tracking-wider">
              <th className="pb-3 pl-2">Asset / ID</th>
              <th className="pb-3 text-right">Quantity</th>
              <th className="pb-3 text-right">Cost Basis</th>
              <th className="pb-3 text-right">Current Price</th>
              <th className="pb-3 text-right">Market Value</th>
              <th className="pb-3 text-right">Unrealized G/L</th>
              <th className="pb-3 text-center">Acquired Date</th>
              <th className="pb-3 text-center">Optimizer Action</th>
              <th className="pb-3 pr-2 text-right">Edit</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((lot) => {
              const isEditing = editingId === lot.id;
              const currentVal = lot.quantity * lot.current_price;
              const unrealized = (lot.current_price - lot.cost_basis) * lot.quantity;
              const isLoss = unrealized < 0;
              const proposal = getProposalDetails(lot.id);

              return (
                <tr
                  key={lot.id}
                  id={`holding-row-${lot.id}`}
                  className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                    proposal ? "bg-amber-500/5 hover:bg-amber-500/10" : ""
                  }`}
                >
                  <td className="py-4 pl-2">
                    {isEditing ? (
                      <input
                        type="text"
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value)}
                        className="w-16 bg-[#161618] text-white border border-white/10 rounded text-xs px-2 py-1 font-mono"
                      />
                    ) : (
                      <div>
                        <span className="font-medium text-white text-sm tracking-tight">{lot.symbol}</span>
                        <span className="block text-[10px] text-white/30 font-mono mt-0.5">{lot.id}</span>
                      </div>
                    )}
                  </td>
                  <td className="py-4 text-right">
                    {isEditing ? (
                      <input
                        type="number"
                        step="any"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className="w-16 bg-[#161618] text-white border border-white/10 rounded text-xs px-2 py-1 text-right font-mono"
                      />
                    ) : (
                      <span className="text-xs text-white/80 font-mono font-medium">{lot.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                    )}
                  </td>
                  <td className="py-4 text-right">
                    {isEditing ? (
                      <input
                        type="number"
                        step="any"
                        value={costBasis}
                        onChange={(e) => setCostBasis(e.target.value)}
                        className="w-16 bg-[#161618] text-white border border-white/10 rounded text-xs px-2 py-1 text-right font-mono"
                      />
                    ) : (
                      <span className="text-xs text-white/60 font-mono">${lot.cost_basis.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="py-4 text-right">
                    {isEditing ? (
                      <input
                        type="number"
                        step="any"
                        value={currentPrice}
                        onChange={(e) => setCurrentPrice(e.target.value)}
                        className="w-16 bg-[#161618] text-white border border-white/10 rounded text-xs px-2 py-1 text-right font-mono"
                      />
                    ) : (
                      <span className="text-xs text-white/60 font-mono">${lot.current_price.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="py-4 text-right">
                    <span className="text-xs font-semibold text-white font-mono">
                      ${currentVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </td>
                  <td className="py-4 text-right">
                    <span className={`text-xs font-mono font-semibold ${isLoss ? "text-rose-400" : "text-emerald-400"}`}>
                      {isLoss ? "-" : "+"}
                      ${Math.abs(unrealized).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </td>
                  <td className="py-4 text-center">
                    {isEditing ? (
                      <input
                        type="date"
                        value={acquiredDate}
                        onChange={(e) => setAcquiredDate(e.target.value)}
                        className="w-28 bg-[#161618] text-white border border-white/10 rounded text-xs px-2 py-1 font-mono text-white/80"
                      />
                    ) : (
                      <span className="text-xs text-white/40 font-mono">{lot.acquired_date}</span>
                    )}
                  </td>
                  <td className="py-4 text-center">
                    {proposal ? (
                      <div className="inline-flex flex-col items-center">
                        <span className="px-2.5 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-bold rounded-full border border-amber-500/20 uppercase tracking-wide">
                          PROPOSED TO SELL
                        </span>
                        <span className="text-[10px] text-amber-400/70 font-mono mt-1">
                          {proposal.quantity === lot.quantity ? "Entire lot" : `${proposal.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares`}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-white/20">—</span>
                    )}
                  </td>
                  <td className="py-4 pr-2 text-right">
                    {isEditing ? (
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => handleEditSave(lot.id)}
                          className="p-1 bg-emerald-950/40 text-emerald-400 rounded border border-emerald-500/20 hover:bg-emerald-900/40 transition cursor-pointer"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 bg-rose-950/40 text-rose-400 rounded border border-rose-500/20 hover:bg-rose-900/40 transition cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5 justify-end">
                        <button
                          onClick={() => handleEditStart(lot)}
                          className="p-1 text-white/40 hover:text-white rounded hover:bg-white/5 transition cursor-pointer"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(lot.id)}
                          className="p-1 text-white/40 hover:text-rose-400 rounded hover:bg-rose-500/5 transition cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {holdings.length === 0 && (
          <div className="text-center py-8 text-white/30 text-xs font-mono">
            No holdings found. Click 'Add Tax Lot' to populate assets.
          </div>
        )}
      </div>
    </div>
  );
}
