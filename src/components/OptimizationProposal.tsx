import React, { useState } from "react";
import { ProposalOutput, HoldingLot } from "../types";
import { ShieldCheck, AlertCircle, FileText, ChevronDown, ChevronUp, CheckCircle2, UserCheck, Code } from "lucide-react";

interface OptimizationProposalProps {
  proposal: ProposalOutput;
  aiRationale: string;
  onApprove: () => void;
  isLoading: boolean;
  selectedModel?: string;
  provider?: string;
}

export default function OptimizationProposal({ proposal, aiRationale, onApprove, isLoading, selectedModel = "gemini-3-flash-preview-free", provider = "deterministic" }: OptimizationProposalProps) {
  const [showJson, setShowJson] = useState(false);
  const [isApprovedSuccessfully, setIsApprovedSuccessfully] = useState(false);

  const handleApproveClick = () => {
    onApprove();
    setIsApprovedSuccessfully(true);
    setTimeout(() => {
      setIsApprovedSuccessfully(false);
    }, 4000);
  };

  const getLtvColor = (ltv: number, limit: number) => {
    const ratio = ltv / limit;
    if (ratio >= 1.0) return "text-rose-600 bg-rose-50 border-rose-100";
    if (ratio >= 0.8) return "text-amber-600 bg-amber-50 border-amber-100";
    return "text-emerald-600 bg-emerald-50 border-emerald-100";
  };

  const getLtvBarColor = (ltv: number, limit: number) => {
    const ratio = ltv / limit;
    if (ratio >= 1.0) return "bg-rose-500";
    if (ratio >= 0.8) return "bg-amber-500";
    return "bg-emerald-500";
  };

  // Safe LTV calculations
  const isBreached = proposal.headroom_dollars < 0;

  return (
    <div id="optimizer-proposal-container" className="bg-[#111113] border border-white/10 rounded-2xl p-6 flex flex-col gap-6 shadow-xl">
      <div className="flex justify-between items-start border-b border-white/10 pb-4">
        <div>
          <h3 className="font-sans font-medium text-base text-white">Optimization Action Plan</h3>
          <p className="text-xs text-white/40 font-mono mt-1">Tax-minimized asset liquidation proposals</p>
        </div>
        <span className={`px-3 py-1 text-[10px] font-bold tracking-wider uppercase rounded-lg border ${
          proposal.risk_state === "High Risk" 
            ? "bg-rose-500/15 text-rose-400 border-rose-500/25" 
            : proposal.risk_state === "Warning"
            ? "bg-amber-500/15 text-amber-400 border-amber-500/25"
            : "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
        }`}>
          {proposal.risk_state} Risk
        </span>
      </div>

      {/* LTV & Headroom KPI Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-white/5 rounded-xl p-4 bg-[#161618]/70">
          <span className="text-[9px] font-bold text-white/30 uppercase font-mono tracking-widest block mb-1.5">Current LTV Ratio</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-light font-mono text-white">{(proposal.current_ltv * 100).toFixed(2)}%</span>
            <span className="text-[10px] text-white/30 font-mono">/ 50.0% max limit</span>
          </div>
          <div className="w-full bg-white/5 h-1.5 rounded-full mt-3 overflow-hidden">
            <div 
              className={`h-full ${getLtvBarColor(proposal.current_ltv, 0.50)}`}
              style={{ width: `${Math.min(100, (proposal.current_ltv / 0.50) * 100)}%` }}
            />
          </div>
        </div>

        <div className="border border-white/5 rounded-xl p-4 bg-[#161618]/70">
          <span className="text-[9px] font-bold text-white/30 uppercase font-mono tracking-widest block mb-1.5">Borrowing Headroom</span>
          <span className={`text-2xl font-mono block ${isBreached ? "text-rose-400 animate-pulse font-semibold" : "text-white font-light"}`}>
            ${proposal.headroom_dollars.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] text-white/30 font-mono block mt-1">
            {isBreached ? "🚨 Action Required: Deficit" : "✓ Within safe margin"}
          </span>
        </div>

        <div className="border border-white/5 rounded-xl p-4 bg-[#161618]/70">
          <span className="text-[9px] font-bold text-white/30 uppercase font-mono tracking-widest block mb-1.5">Resulting LTV (Pro-Forma)</span>
          <span className="text-2xl font-light font-mono text-white block">
            {(proposal.resulting_ltv_if_executed * 100).toFixed(2)}%
          </span>
          <span className="text-[10px] text-emerald-400 font-mono block mt-1">
            {proposal.proposed_lots_to_sell.length > 0 ? "✓ Restores safe leverage" : "No changes pending"}
          </span>
        </div>
      </div>

      {/* Recommended Actions List */}
      <div>
        <h4 className="text-[10px] font-bold text-white/40 uppercase tracking-widest font-mono mb-3">Proposed Asset Executions</h4>
        {proposal.proposed_lots_to_sell.length > 0 ? (
          <div className="flex flex-col gap-3">
            {proposal.proposed_lots_to_sell.map((trade) => (
              <div 
                key={trade.lot_id}
                id={`proposal-card-${trade.lot_id}`}
                className={`p-4 border rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-3 transition-all ${
                  trade.wash_sale_caution 
                    ? "border-amber-500/20 bg-amber-500/5 text-amber-300" 
                    : "border-white/5 bg-[#161618] hover:border-white/10 text-white"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">Sell {trade.symbol}</span>
                    <span className="text-xs font-mono text-white/30">(Lot: {trade.lot_id})</span>
                  </div>
                  <div className="text-xs text-white/40 mt-1 flex flex-wrap gap-x-4">
                    <span>Qty to liquidate: <strong className="font-mono text-white/75">{trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong></span>
                    <span>Est. Proceeds: <strong className="font-mono text-white/75">${trade.est_proceeds.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 w-full md:w-auto">
                  <div className="text-right">
                    <span className="text-[9px] text-white/30 block uppercase font-mono tracking-widest">Realized Gain/Loss</span>
                    <span className={`text-sm font-bold font-mono ${trade.realized_gain_loss < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                      {trade.realized_gain_loss < 0 ? "" : "+"}
                      ${trade.realized_gain_loss.toLocaleString()}
                    </span>
                  </div>
                  {trade.wash_sale_caution && (
                    <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 text-[9px] font-bold rounded uppercase border border-rose-500/20 tracking-wider">
                      ⚠️ Wash-Sale Caution
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 border border-dashed border-white/10 rounded-xl text-white/30 text-xs font-mono">
            No trades are currently required to maintain margin compliance or liquidity.
          </div>
        )}
      </div>

      {/* AI Assistant Rationale Panel */}
      <div id="advisor-explanation" className="bg-[#161618] border border-white/5 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-white/5 text-white/80 rounded border border-white/10">
              <UserCheck size={14} />
            </span>
            <h4 className="font-sans font-medium text-sm text-white">Agent Strategy & Rationale</h4>
          </div>
          <span className="text-[10px] font-mono text-white/40 bg-white/5 border border-white/5 px-2 py-0.5 rounded">
            Model: {selectedModel}
          </span>
        </div>
        <div className="text-xs text-white/60 leading-relaxed space-y-3 whitespace-pre-wrap">
          {isLoading ? (
            <div className="flex items-center gap-2.5 text-white/30 font-mono animate-pulse py-2">
              <span className="w-2 h-2 rounded-full bg-white/40 animate-ping" />
              Agent compiling lowest-tax-cost proposal...
            </div>
          ) : (
            aiRationale
          )}
        </div>
        {!isLoading && (
          <div className="flex items-center gap-2 mt-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
              provider === 'deterministic' ? 'bg-gray-500/10 text-gray-400 border border-gray-500/20' :
              provider === 'zyloo' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
              provider === 'openrouter' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
              'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            }`}>
              {provider === 'deterministic' ? 'Computed deterministically' :
               provider === 'zyloo' ? `Explained by ${selectedModel}` :
               provider === 'openrouter' ? 'Explained by OpenRouter (fallback)' :
               'Explained by Poolside (fallback)'}
            </span>
          </div>
        )}
      </div>

      {/* Human Approval Step Guardrails */}
      <div className="border-t border-white/10 pt-5 flex flex-col gap-4">
        <div className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/10 rounded-xl p-4">
          <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={16} />
          <div>
            <h5 className="text-xs font-semibold text-amber-400 font-sans tracking-wide">Compliance & Trade Guardrails</h5>
            <p className="text-[11px] text-white/50 leading-relaxed mt-1.5">
              <strong>1. Human in the Loop:</strong> This agent never triggers automated stock liquidations or transfers without explicit client approval. Click 'Approve & Execute' below to execute.
              <br className="mb-1" />
              <strong>2. No Advisory Advice:</strong> I am not a licensed financial or tax advisor, and this monitoring calculation is not individualized investment or tax advice. Speak to a professional before finalizing trade executions.
            </p>
          </div>
        </div>

        {proposal.proposed_lots_to_sell.length > 0 && (
          <div className="flex flex-col gap-2">
            <button
              id="btn-approve-trade"
              onClick={handleApproveClick}
              className="w-full py-3.5 bg-white hover:bg-white/90 text-black rounded-xl text-xs font-bold uppercase tracking-widest transition duration-200 flex items-center justify-center gap-2 shadow-lg cursor-pointer"
            >
              <CheckCircle2 size={16} />
              Approve & Execute Proposed Portfolio Rebalance
            </button>
            {isApprovedSuccessfully && (
              <div className="text-center text-xs text-emerald-400 font-bold font-mono animate-pulse py-2 uppercase tracking-wide">
                ✓ Trade orders approved & simulated! Portfolio rebalanced & headroom restored.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collapsible strict JSON display */}
      <div className="border-t border-white/10 pt-4">
        <button
          onClick={() => setShowJson(!showJson)}
          className="flex items-center justify-between w-full text-xs text-white/30 font-mono hover:text-white transition cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <Code size={14} />
            {showJson ? "Hide" : "Show"} Developer Snapshot JSON
          </span>
          {showJson ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showJson && (
          <div className="mt-3 bg-[#0A0A0B] text-[#E0E0E0]/80 rounded-lg p-4 font-mono text-[10px] overflow-x-auto border border-white/5">
            <pre>{JSON.stringify({
              risk_state: proposal.risk_state,
              current_ltv: proposal.current_ltv,
              headroom_dollars: proposal.headroom_dollars,
              recommended_action: proposal.recommended_action,
              proposed_lots_to_sell: proposal.proposed_lots_to_sell,
              resulting_ltv_if_executed: proposal.resulting_ltv_if_executed,
              rationale: proposal.rationale
            }, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* Export Audit Trail */}
      <div className="border-t border-white/10 pt-4">
        <button
          onClick={() => {
            const auditData = {
              timestamp: new Date().toISOString(),
              model_used: selectedModel,
              provider,
              proposal,
              ai_rationale: aiRationale,
            };
            const blob = new Blob([JSON.stringify(auditData, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `collateral-audit-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="flex items-center gap-1.5 text-xs text-white/30 font-mono hover:text-white transition cursor-pointer"
        >
          <FileText size={14} />
          Export Audit Trail
        </button>
      </div>
    </div>
  );
}
