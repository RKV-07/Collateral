import React, { useState } from "react";
import { HoldingLot, ProposedLot } from "../types";
import { type HoldingInput } from "../api";
import { Trash2, Plus, Calendar, Coins, Edit2, Check, X, RefreshCw, Loader2 } from "lucide-react";

interface HoldingsTableProps {
  holdings: HoldingLot[];
  proposedLots: ProposedLot[];
  onAddHolding: (data: HoldingInput) => Promise<void>;
  onUpdateLot: (holdingId: string, lotId: string, patch: Partial<HoldingInput>) => Promise<void>;
  onDeleteLot: (holdingId: string, lotId: string) => Promise<void>;
  onRefreshPrices?: () => void;
  isRefreshingPrices?: boolean;
  isSaving?: boolean;
}

export default function HoldingsTable({
  holdings,
  proposedLots,
  onAddHolding,
  onUpdateLot,
  onDeleteLot,
  onRefreshPrices,
  isRefreshingPrices,
  isSaving,
}: HoldingsTableProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [acquiredDate, setAcquiredDate] = useState(() => new Date().toISOString().slice(0, 10));

  const resetForm = () => {
    setSymbol("");
    setQuantity("");
    setCostBasis("");
    setAcquiredDate(new Date().toISOString().slice(0, 10));
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim() || !quantity || !costBasis) return;
    await onAddHolding({
      symbol: symbol.toUpperCase(),
      quantity: parseFloat(quantity),
      costBasis: parseFloat(costBasis),
      acquiredAt: acquiredDate,
    });
    setIsAdding(false);
    resetForm();
  };

  const handleEditStart = (lot: HoldingLot) => {
    setEditingId(lot.id);
    setSymbol(lot.symbol);
    setQuantity(lot.quantity.toString());
    setCostBasis(lot.cost_basis.toString());
    setAcquiredDate(lot.acquired_date);
  };

  const handleEditSave = async (lot: HoldingLot) => {
    if (!lot.holdingId) return;
    await onUpdateLot(lot.holdingId, lot.id, {
      symbol: symbol.toUpperCase(),
      quantity: parseFloat(quantity),
      costBasis: parseFloat(costBasis),
      acquiredAt: acquiredDate,
    });
    setEditingId(null);
    resetForm();
  };

  const handleDelete = async (lot: HoldingLot) => {
    if (!lot.holdingId) return;
    setPendingDeleteId(lot.id);
    try {
      await onDeleteLot(lot.holdingId, lot.id);
    } finally {
      setPendingDeleteId(null);
    }
  };

  const getProposalDetails = (lotId: string) => proposedLots.find((p) => p.lot_id === lotId);

  return (
    <div id="holdings-container" className="bg-platter border border-line rounded-2xl p-6 shadow-xl">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <div>
          <h3 className="font-sans font-medium text-base text-white">Portfolio Asset Lots</h3>
          <p className="text-xs text-white/40 font-mono mt-1">Your persisted holdings — live prices fetched on demand</p>
        </div>
        <div className="flex items-center gap-2">
          {onRefreshPrices && (
            <button
              id="btn-refresh-prices"
              onClick={onRefreshPrices}
              disabled={isRefreshingPrices}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-line text-white/70 hover:text-white rounded-lg text-xs font-medium transition cursor-pointer disabled:opacity-40"
            >
              <RefreshCw size={13} className={isRefreshingPrices ? "animate-spin" : ""} />
              {isRefreshingPrices ? "Refreshing..." : "Refresh Live Prices"}
            </button>
          )}
          <button
            id="btn-add-lot"
            onClick={() => setIsAdding(!isAdding)}
            className="flex items-center gap-2 px-3 py-1.5 bg-white text-black rounded-lg hover:bg-white/90 text-xs font-semibold tracking-tight transition cursor-pointer"
          >
            {isAdding ? <X size={14} /> : <Plus size={14} />}
            {isAdding ? "Cancel" : "Add Tax Lot"}
          </button>
        </div>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-platter border border-line rounded-xl p-4 mb-6 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Symbol</label>
            <input
              type="text"
              placeholder="e.g. AAPL"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
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
              className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
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
              className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Acquired Date</label>
            <input
              type="date"
              value={acquiredDate}
              onChange={(e) => setAcquiredDate(e.target.value)}
              className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono text-white/80"
              required
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full p-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg transition h-[38px] flex items-center justify-center gap-1.5 cursor-pointer text-xs font-semibold"
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {isSaving ? "Saving" : "Add"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase text-white/40 font-mono tracking-wider">
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
                        className="w-16 bg-platter text-white border border-line rounded text-xs px-2 py-1 font-mono"
                      />
                    ) : (
                      <div>
                        <span className="font-medium text-white text-sm tracking-tight">{lot.symbol}</span>
                        <span className="block text-[10px] text-white/30 font-mono mt-0.5">{lot.id.slice(0, 12)}</span>
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
                        className="w-16 bg-platter text-white border border-line rounded text-xs px-2 py-1 text-right font-mono"
                      />
                    ) : (
                      <span className="text-xs text-white/80 font-mono font-medium">
                        {lot.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                    )}
                  </td>
                  <td className="py-4 text-right">
                    {isEditing ? (
                      <input
                        type="number"
                        step="any"
                        value={costBasis}
                        onChange={(e) => setCostBasis(e.target.value)}
                        className="w-16 bg-platter text-white border border-line rounded text-xs px-2 py-1 text-right font-mono"
                      />
                    ) : (
                      <span className="text-xs text-white/60 font-mono">${lot.cost_basis.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="py-4 text-right">
                    <span className="text-xs text-white/60 font-mono">${lot.current_price.toFixed(2)}</span>
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
                        className="w-28 bg-platter text-white border border-line rounded text-xs px-2 py-1 font-mono text-white/80"
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
                          {proposal.quantity === lot.quantity
                            ? "Entire lot"
                            : `${proposal.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares`}
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
                          onClick={() => handleEditSave(lot)}
                          disabled={isSaving}
                          className="p-1 bg-emerald-950/40 text-emerald-400 rounded border border-emerald-500/20 hover:bg-emerald-900/40 transition cursor-pointer disabled:opacity-40"
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
                          onClick={() => handleDelete(lot)}
                          disabled={pendingDeleteId === lot.id}
                          className="p-1 text-white/40 hover:text-rose-400 rounded hover:bg-rose-500/5 transition cursor-pointer disabled:opacity-40"
                        >
                          {pendingDeleteId === lot.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
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
            No holdings yet. Click &apos;Add Tax Lot&apos; to enter your first position.
          </div>
        )}
      </div>
    </div>
  );
}