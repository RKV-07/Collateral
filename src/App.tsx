import React, { useState, useEffect, useCallback } from "react";
import { AccountSnapshot, ProposalOutput, HoldingLot, MarketEvent } from "./types";
import { INITIAL_PRESETS } from "./presets";
import { calculateOptimizer, getAdjustedSnapshot } from "./utils";
import HoldingsTable from "./components/HoldingsTable";
import OptimizationProposal from "./components/OptimizationProposal";
import ChatAssistant from "./components/ChatAssistant";
import { 
  Activity, 
  Coins, 
  Percent, 
  SlidersHorizontal, 
  TrendingDown, 
  HelpCircle, 
  Clock, 
  Sparkles, 
  UserCheck, 
  AlertOctagon, 
  AlertTriangle, 
  CheckCircle, 
  Info,
  RefreshCw
} from "lucide-react";

const AVAILABLE_MODELS = [
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", badge: "Recommended", desc: "Fastest response with top reasoning quality" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", badge: "Deep Reasoning", desc: "Maximum analytical depth for complex tax strategies" },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", badge: "Low Latency", desc: "Next-gen low-latency model for instant chat" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", badge: "Lightweight", desc: "High efficiency for rapid metric checking" },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", badge: "High Context", desc: "Legacy pro model with extensive context support" },
];

export default function App() {
  // Preset selection
  const [selectedPreset, setSelectedPreset] = useState<string>("breached");
  
  // Model selection
  const [selectedModel, setSelectedModel] = useState<string>("gemini-2.5-flash");

  // Custom portfolio states
  const [cash, setCash] = useState<number>(0);
  const [loanBalance, setLoanBalance] = useState<number>(4500);
  const [maintenanceLimit, setMaintenanceLimit] = useState<number>(0.50);
  const [holdings, setHoldings] = useState<HoldingLot[]>(INITIAL_PRESETS.breached.snapshot.holdings);

  // Liquidity & market scenario simulation state
  const [cashNeed, setCashNeed] = useState<number>(0);
  const [marketDropPct, setMarketDropPct] = useState<number>(0); // e.g. 20 for 20% drop

  // Calculated optimizer output & AI rationale
  const [proposal, setProposal] = useState<ProposalOutput>(() => {
    const initSnap: AccountSnapshot = {
      cash: 0,
      loan_balance: 4500,
      maintenance_ltv_limit: 0.50,
      holdings: INITIAL_PRESETS.breached.snapshot.holdings,
    };
    return calculateOptimizer(initSnap, 0, undefined);
  });
  const [geminiRationale, setGeminiRationale] = useState<string>("");
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);

  // Sync state when switching presets
  const handleLoadPreset = (key: string) => {
    const preset = INITIAL_PRESETS[key];
    if (preset) {
      setSelectedPreset(key);
      setCash(preset.snapshot.cash);
      setLoanBalance(preset.snapshot.loan_balance);
      setMaintenanceLimit(preset.snapshot.maintenance_ltv_limit);
      setHoldings(preset.snapshot.holdings);
      setCashNeed(0);
      setMarketDropPct(0);
    }
  };

  // Re-run the optimizer whenever the snapshot parameters, cash need, market drop or selected model change
  const runOptimization = useCallback(async () => {
    const currentSnap: AccountSnapshot = {
      cash,
      loan_balance: loanBalance,
      maintenance_ltv_limit: maintenanceLimit,
      holdings,
    };

    const marketEvent: MarketEvent | undefined = marketDropPct > 0 
      ? { 
          description: `Portfolio value fell ${marketDropPct}% today due to market simulation`,
          global_adjustment: -(marketDropPct / 100),
        }
      : undefined;

    // First do immediate local deterministic calculation to keep UI completely responsive
    const localResult = calculateOptimizer(currentSnap, cashNeed, marketEvent);
    setProposal(localResult);

    // Then fetch server-side analysis which triggers the smart Gemini explanations
    setIsAiLoading(true);
    try {
      const response = await fetch("/api/portfolio/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot: currentSnap,
          cashNeed,
          marketEvent,
          model: selectedModel,
        }),
      });
      const data = await response.json();
      if (response.ok && data.gemini_rationale) {
        setGeminiRationale(data.gemini_rationale);
      } else {
        setGeminiRationale(localResult.rationale);
      }
    } catch (err) {
      console.error("AI Analysis error:", err);
      // Fallback to our perfect deterministic local rationale
      setGeminiRationale(localResult.rationale);
    } finally {
      setIsAiLoading(false);
    }
  }, [cash, loanBalance, maintenanceLimit, holdings, cashNeed, marketDropPct, selectedModel]);

  useEffect(() => {
    runOptimization();
  }, [runOptimization]);

  // Handle trade approval execution simulation (applies proposed rebalances directly to local state)
  const handleApproveRebalance = () => {
    if (proposal.proposed_lots_to_sell.length === 0) return;

    // Apply the paydown proceeds to the loan balance, remove/adjust the lots
    let totalProceeds = 0;
    const updatedHoldings = holdings.map((lot) => {
      const proposed = proposal.proposed_lots_to_sell.find((p) => p.lot_id === lot.id);
      if (proposed) {
        totalProceeds += proposed.est_proceeds;
        return {
          ...lot,
          quantity: Math.max(0, lot.quantity - proposed.quantity),
        };
      }
      return lot;
    }).filter((lot) => lot.quantity > 0.0001);

    // Calculate how much was needed for paydown
    const shortfall = proposal.headroom_dollars < 0 ? Math.abs(proposal.headroom_dollars) : 0;
    const h_proforma = proposal.headroom_dollars - cashNeed * maintenanceLimit;
    let paydown_needed = 0;
    if (h_proforma < 0) {
      paydown_needed = Math.abs(h_proforma) / (1 - maintenanceLimit);
    }

    const paydownAmount = Math.min(paydown_needed, totalProceeds);

    // Reduce loan balance and update holdings
    setLoanBalance(Math.max(0, parseFloat((loanBalance - paydownAmount).toFixed(2))));
    setHoldings(updatedHoldings);
    
    // Reset inputs
    setCashNeed(0);
    setMarketDropPct(0);
  };

  const collateralValue = holdings.reduce((sum, h) => {
    // apply market drop to current display
    const price = h.current_price * (1 - marketDropPct / 100);
    return sum + h.quantity * price;
  }, 0);

  const roundedCollateral = parseFloat(collateralValue.toFixed(2));

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-[#E0E0E0] pb-16 font-sans selection:bg-white/20 selection:text-white">
      
      {/* Global Margin Status Header Alert */}
      {proposal.headroom_dollars < 0 && (
        <div id="global-margin-call-banner" className="bg-rose-950/90 text-rose-200 border-b border-rose-500/30 px-6 py-4 flex items-center justify-between shadow-[0_4px_20px_rgba(244,63,94,0.15)] text-xs font-semibold animate-pulse">
          <div className="flex items-center gap-3">
            <span className="p-1 bg-rose-500/20 border border-rose-500/30 rounded text-rose-400">
              <AlertOctagon size={16} />
            </span>
            <span>
              <strong className="text-rose-400 uppercase tracking-wide">Urgent Margin Deficit:</strong> LTV limit is currently breached! Deficit of <strong className="font-mono text-white">${Math.abs(proposal.headroom_dollars).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong> requires immediate trade liquidation.
            </span>
          </div>
          <a href="#optimizer-proposal-container" className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded font-medium transition shrink-0 shadow-lg text-[11px] uppercase tracking-wider">
            Review Proposal
          </a>
        </div>
      )}

      {/* Decorative Navigation Header */}
      <header className="bg-[#111113] border-b border-white/10 px-8 py-5 sticky top-0 z-40 backdrop-blur-md bg-opacity-90">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-bold text-black shadow-lg shadow-white/5 transition-transform hover:scale-105">
              Σ
            </div>
            <div>
              <h1 className="font-sans font-medium text-lg text-white tracking-tight flex items-center gap-2">
                Portfolio Optimizer
                <span className="text-white/40 font-normal">— Liquidity & Tax Agent</span>
              </h1>
              <p className="text-xs text-white/40">Automated LTV monitoring & tax-lot loss harvesting engine</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs font-mono text-white/40">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${proposal.headroom_dollars < 0 ? "bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-ping" : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"}`}></div>
              <span className={`font-bold uppercase tracking-wider text-[10px] ${proposal.headroom_dollars < 0 ? "text-rose-500" : "text-emerald-500"}`}>
                {proposal.headroom_dollars < 0 ? "High Risk / Margin Call" : "System Status: Nominal"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 border-l border-white/10 pl-4">
              <Clock size={13} />
              <span>UTC: <strong className="text-white/80">2026-07-21 13:14:10</strong></span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 mt-8 flex flex-col gap-8">
        
        {/* Gemini Model Selector Card */}
        <section className="bg-[#111113] border border-white/10 rounded-2xl p-6 shadow-xl">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <span className="p-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg">
                <Sparkles size={16} />
              </span>
              <div>
                <h2 className="font-sans font-medium text-sm text-white">Gemini AI Model Engine</h2>
                <p className="text-xs text-white/40">Select the Gemini intelligence model for real-time portfolio analysis & strategy generation</p>
              </div>
            </div>
            <span className="text-[11px] font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full uppercase tracking-wider shrink-0">
              Active: {selectedModel}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {AVAILABLE_MODELS.map((m) => {
              const isSelected = selectedModel === m.id;
              return (
                <button
                  key={m.id}
                  id={`model-select-${m.id}`}
                  onClick={() => setSelectedModel(m.id)}
                  className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer group ${
                    isSelected
                      ? "border-amber-400/80 bg-amber-500/10 shadow-lg ring-1 ring-amber-400/30 text-white"
                      : "border-white/5 bg-[#161618]/60 hover:bg-[#161618] hover:border-white/15 text-white/70"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className={`font-mono text-xs font-bold ${isSelected ? "text-amber-300" : "text-white"}`}>
                        {m.name}
                      </span>
                    </div>
                    <p className="text-[11px] text-white/40 leading-snug line-clamp-2 mt-1">{m.desc}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                      isSelected ? "bg-amber-400 text-black font-semibold" : "bg-white/5 text-white/40 border border-white/5"
                    }`}>
                      {m.badge}
                    </span>
                    {isSelected && <CheckCircle size={14} className="text-amber-400" />}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Scenario Preset Selector */}
        <section className="bg-[#111113] border border-white/10 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-2.5 mb-4">
            <SlidersHorizontal size={15} className="text-white/40" />
            <h2 className="font-sans font-medium text-xs text-white/50 uppercase tracking-widest font-mono">Sandbox Scenarios & States</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(INITIAL_PRESETS).map(([key, value]) => {
              const isActive = selectedPreset === key;
              return (
                <button
                  key={key}
                  id={`btn-preset-${key}`}
                  onClick={() => handleLoadPreset(key)}
                  className={`p-5 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer group ${
                    isActive 
                      ? "border-white bg-[#161618] shadow-lg ring-1 ring-white/10" 
                      : "border-white/5 bg-[#161618]/40 hover:bg-[#161618] hover:border-white/10"
                  }`}
                >
                  <div>
                    <h3 className={`font-medium text-sm tracking-tight transition-colors ${isActive ? "text-white" : "text-white/80 group-hover:text-white"}`}>{value.name}</h3>
                    <p className="text-xs text-white/40 leading-relaxed mt-2">{value.description}</p>
                  </div>
                  <span className={`text-[9px] font-bold mt-4 uppercase tracking-widest font-mono ${
                    key === "breached" ? "text-rose-500" : key === "warning" ? "text-amber-500" : "text-emerald-500"
                  }`}>
                    {key === "breached" ? "● active margin call" : key === "warning" ? "● close to limit" : "● safe state"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Dashboard Workstation Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Account Settings & Simulation Sliders */}
          <div className="lg:col-span-1 flex flex-col gap-8">
            
            {/* Parameters Control Panel */}
            <div className="bg-[#111113] border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col gap-5">
              <div>
                <h3 className="font-sans font-medium text-xs text-white/50 uppercase tracking-widest font-mono">Margin Account Properties</h3>
                <p className="text-xs text-white/40 mt-1">Configure live leverage parameters & limits</p>
              </div>

              {/* Cash Balance */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1.5 font-mono">Cash Balance ($)</label>
                <input
                  type="number"
                  value={cash}
                  onChange={(e) => setCash(parseFloat(e.target.value) || 0)}
                  className="w-full text-xs bg-[#161618] text-white border border-white/10 rounded-lg p-2.5 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/10 transition-all font-mono"
                />
              </div>

              {/* Loan Balance */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1.5 font-mono">Active Loan Balance ($)</label>
                <input
                  type="number"
                  value={loanBalance}
                  onChange={(e) => setLoanBalance(parseFloat(e.target.value) || 0)}
                  className="w-full text-xs bg-[#161618] text-white border border-white/10 rounded-lg p-2.5 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/10 transition-all font-mono"
                />
              </div>

              {/* Maintenance Limit */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-[10px] uppercase tracking-wider text-white/40 font-mono">Maintenance LTV Limit</label>
                  <span className="text-xs font-bold text-white font-mono">{(maintenanceLimit * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="0.80"
                  step="0.05"
                  value={maintenanceLimit}
                  onChange={(e) => setMaintenanceLimit(parseFloat(e.target.value))}
                  className="w-full accent-white cursor-pointer"
                />
              </div>
            </div>

            {/* Interactive Simulations Panel */}
            <div className="bg-[#111113] border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col gap-6">
              <div>
                <h3 className="font-sans font-medium text-xs text-white/50 uppercase tracking-widest font-mono">Scenario Simulations</h3>
                <p className="text-xs text-white/40 mt-1">Simulate real-time portfolio liquidity needs & price falls</p>
              </div>

              {/* Cash Raise Slider */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-[10px] uppercase tracking-wider text-white/50 font-mono flex items-center gap-1.5">
                    <Coins size={12} className="text-white/40" />
                    Requested Cash Liquidity
                  </label>
                  <span className="text-xs font-bold text-white font-mono">${cashNeed.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="15000"
                  step="500"
                  value={cashNeed}
                  onChange={(e) => setCashNeed(parseInt(e.target.value))}
                  className="w-full accent-white cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-white/30 font-mono mt-1.5 uppercase tracking-wide">
                  <span>$0</span>
                  <span>Withdraw Cash</span>
                  <span>$15k Max</span>
                </div>
              </div>

              {/* Market Drop Simulator Slider */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-[10px] uppercase tracking-wider text-rose-400 font-mono flex items-center gap-1.5">
                    <TrendingDown size={12} className="text-rose-400" />
                    Market Shock Drop
                  </label>
                  <span className="text-xs font-bold text-rose-400 font-mono">-{marketDropPct}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="5"
                  value={marketDropPct}
                  onChange={(e) => setMarketDropPct(parseInt(e.target.value))}
                  className="w-full accent-rose-500 cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-rose-400/50 font-mono mt-1.5 uppercase tracking-wide">
                  <span>No shock</span>
                  <span>Downturn</span>
                  <span>-50% Crash</span>
                </div>
              </div>

              {/* Market Shocks Presets */}
              <div className="flex flex-col gap-2.5 pt-2 border-t border-white/5">
                <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-white/30">Quick Market Shocks</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMarketDropPct(15)}
                    className="py-2 border border-rose-500/20 text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/5 rounded-lg text-[10px] font-semibold tracking-wider uppercase transition"
                  >
                    Tech Selloff (-15%)
                  </button>
                  <button
                    onClick={() => setMarketDropPct(25)}
                    className="py-2 border border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10 text-rose-300 rounded-lg text-[10px] font-bold tracking-wider uppercase transition"
                  >
                    Flash Crash (-25%)
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column: Holdings Grid, Proposals, and Agent Advisor */}
          <div className="lg:col-span-2 flex flex-col gap-8">
            
            {/* Holdings & Tax Lots Table */}
            <HoldingsTable 
              holdings={holdings} 
              proposedLots={proposal.proposed_lots_to_sell} 
              onUpdateHoldings={setHoldings} 
            />

            {/* Tax Lot Optimization Execution Proposal */}
            <OptimizationProposal 
              proposal={proposal} 
              geminiRationale={geminiRationale} 
              onApprove={handleApproveRebalance} 
              isLoading={isAiLoading}
              selectedModel={selectedModel}
            />

            {/* Interactive Chat Assistant */}
            <ChatAssistant 
              currentSnapshot={{
                cash,
                loan_balance: loanBalance,
                maintenance_ltv_limit: maintenanceLimit,
                holdings,
              }}
              cashNeed={cashNeed}
              marketEventDescription={marketDropPct > 0 ? `Portfolio fell ${marketDropPct}%` : ""}
              selectedModel={selectedModel}
            />

          </div>

        </div>

      </main>

      {/* Global Regulatory Footer */}
      <footer className="mt-20 border-t border-white/10 bg-[#111113]/50 py-10 text-center text-xs text-white/30 font-mono">
        <div className="max-w-7xl mx-auto px-8 flex flex-col items-center gap-3">
          <span>© 2026 Liquidity & Tax Optimizer Agent. Powered by Google AI Studio Build.</span>
          <span className="max-w-2xl leading-relaxed text-[11px] text-white/50 font-sans mt-1">
            <strong>Disclaimer:</strong> This application acts as an educational and monitoring sandbox. The agent is not a licensed financial or tax advisor and the calculated metrics do not represent individualized investment or tax advice. Every proposed transaction must pass through a human-approval step before any orders can be simulated.
          </span>
        </div>
      </footer>

    </div>
  );
}
