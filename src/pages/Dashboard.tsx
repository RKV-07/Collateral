import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  AccountSnapshot,
  ProposalOutput,
  HoldingLot,
  MarketEvent,
  PublicRegistry,
} from "../types";
import { calculateOptimizer, getAdjustedSnapshot } from "../utils";
import { api, ApiError, PortfolioDTO, HoldingInput, PriceInfo, UserDTO } from "../api";
import HoldingsTable from "../components/HoldingsTable";
import OptimizationProposal from "../components/OptimizationProposal";
import ChatAssistant from "../components/ChatAssistant";
import ModelManager from "../components/ModelManager";
import { useAuth } from "../useAuth";
import {
  Activity,
  Coins,
  SlidersHorizontal,
  TrendingDown,
  HelpCircle,
  Clock,
  Sparkles,
  UserCheck,
  AlertOctagon,
  Settings2,
  Plus,
  Loader2,
} from "lucide-react";

async function safeApi<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      window.location.href = "/";
    }
    throw err;
  }
}

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Persisted portfolio state
  const [portfolio, setPortfolio] = useState<PortfolioDTO | null>(null);
  const [loadingPortfolio, setLoadingPortfolio] = useState(true);
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  // Account properties (bound to the Portfolio row, persisted on change)
  const [cash, setCash] = useState(0);
  const [loanBalance, setLoanBalance] = useState(0);
  const [maintenanceLimit, setMaintenanceLimit] = useState(0.5);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scenario simulation
  const [cashNeed, setCashNeed] = useState(0);
  const [marketDropPct, setMarketDropPct] = useState(0);

  // Model / provider selection
  const [registry, setRegistry] = useState<PublicRegistry | null>(null);
  const [selectedProvider, setSelectedProvider] = useState("gemini");
  const [selectedModel, setSelectedModel] = useState("gemini-3-flash-preview");
  const [showModelManager, setShowModelManager] = useState(false);

  // Optimizer output
  const [proposal, setProposal] = useState<ProposalOutput | null>(null);
  const [aiRationale, setAiRationale] = useState("");
  const [aiProvider, setAiProvider] = useState("deterministic");
  const [isAiLoading, setIsAiLoading] = useState(false);

  const refreshPrices = useCallback(async (symbols: string[]) => {
    if (symbols.length === 0) return;
    setIsRefreshingPrices(true);
    try {
      const data = await safeApi<{ prices: Record<string, PriceInfo> }>("/api/portfolio/prices", {
        method: "POST",
        body: JSON.stringify({ symbols }),
      });
      setPrices(data.prices);
    } catch (err) {
      console.error("Live price refresh failed:", err);
    } finally {
      setIsRefreshingPrices(false);
    }
  }, []);

  const loadPortfolio = useCallback(async () => {
    try {
      const data = await safeApi<{ portfolio: PortfolioDTO }>("/api/portfolio");
      setPortfolio(data.portfolio);
      setCash(data.portfolio.cash);
      setLoanBalance(data.portfolio.loanBalance);
      setMaintenanceLimit(data.portfolio.maintenanceLtvLimit);
      setPortfolioError(null);
      const symbols = data.portfolio.holdings.map((h) => h.symbol);
      if (symbols.length > 0) void refreshPrices(symbols);
    } catch (err: any) {
      setPortfolioError(err?.message || "Failed to load portfolio.");
    } finally {
      setLoadingPortfolio(false);
    }
  }, [refreshPrices]);

  // Load portfolio on mount + refresh prices every 60s (server caches anyway)
  useEffect(() => {
    loadPortfolio();
    const interval = setInterval(() => {
      setPortfolio((pf) => {
        if (pf && pf.holdings.length > 0) void refreshPrices(pf.holdings.map((h) => h.symbol));
        return pf;
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, [loadPortfolio, refreshPrices]);

  // Flatten persisted holdings into HoldingLot[] with live prices
  const holdings: HoldingLot[] = useMemo(() => {
    if (!portfolio) return [];
    const lots: HoldingLot[] = [];
    for (const h of portfolio.holdings) {
      for (const lot of h.lots) {
        const live = prices[h.symbol];
        lots.push({
          id: lot.id,
          holdingId: h.id,
          symbol: h.symbol,
          quantity: lot.quantity,
          cost_basis: lot.costBasis,
          acquired_date: lot.acquiredDate,
          current_price: live && live.price > 0 ? live.price : lot.costBasis,
        });
      }
    }
    return lots;
  }, [portfolio, prices]);

  // Load the provider/model registry once
  useEffect(() => {
    fetch("/api/models")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PublicRegistry | null) => {
        if (data) {
          setRegistry(data);
          setSelectedProvider(data.defaultProvider);
          setSelectedModel(data.defaultModel);
        }
      })
      .catch(() => {});
  }, []);

  // Persist account properties (debounced) to the Portfolio row
  const persistAccountProps = useCallback((next: { cash?: number; loanBalance?: number; maintenanceLtvLimit?: number }) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      safeApi<{ portfolio: PortfolioDTO }>("/api/portfolio", {
        method: "PATCH",
        body: JSON.stringify(next),
      })
        .then((d) => {
          setPortfolio(d.portfolio);
          setCash(d.portfolio.cash);
          setLoanBalance(d.portfolio.loanBalance);
          setMaintenanceLimit(d.portfolio.maintenanceLtvLimit);
        })
        .catch((err) => console.error("Persist account props failed:", err));
    }, 400);
  }, []);

  // Holding CRUD — all persisted, then reloaded
  const handleAddHolding = useCallback(
    async (data: HoldingInput) => {
      setIsSaving(true);
      try {
        await safeApi("/api/portfolio/holdings", {
          method: "POST",
          body: JSON.stringify(data),
        });
        await loadPortfolio();
      } catch (err) {
        console.error("Add holding failed:", err);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [loadPortfolio]
  );

  const handleUpdateLot = useCallback(
    async (holdingId: string, lotId: string, patch: Partial<HoldingInput>) => {
      setIsSaving(true);
      try {
        await safeApi(`/api/portfolio/holdings/${holdingId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...patch, lotId }),
        });
        await loadPortfolio();
      } catch (err) {
        console.error("Edit holding failed:", err);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [loadPortfolio]
  );

  const handleDeleteLot = useCallback(
    async (holdingId: string) => {
      setIsSaving(true);
      try {
        await safeApi(`/api/portfolio/holdings/${holdingId}`, { method: "DELETE" });
        await loadPortfolio();
      } catch (err) {
        console.error("Remove holding failed:", err);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [loadPortfolio]
  );

  // Run the optimizer (local deterministic + server AI rationale)
  const runOptimization = useCallback(async () => {
    const currentSnap: AccountSnapshot = {
      cash,
      loan_balance: loanBalance,
      maintenance_ltv_limit: maintenanceLimit,
      holdings,
    };

    const marketEvent: MarketEvent | undefined =
      marketDropPct > 0
        ? {
            description: `Portfolio value fell ${marketDropPct}% today due to market simulation`,
            global_adjustment: -(marketDropPct / 100),
          }
        : undefined;

    const localResult = calculateOptimizer(currentSnap, cashNeed, marketEvent);
    setProposal(localResult);

    setIsAiLoading(true);
    try {
      const response = await fetch("/api/portfolio/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot: currentSnap,
          cashNeed,
          marketEvent,
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const data = await response.json();
      if (response.ok && data.ai_rationale) {
        setAiRationale(data.ai_rationale);
        setAiProvider(data.provider || "deterministic");
      } else {
        setAiRationale(localResult.rationale);
        setAiProvider("deterministic");
      }
    } catch (err) {
      console.error("AI Analysis error:", err);
      setAiRationale(localResult.rationale);
      setAiProvider("deterministic");
    } finally {
      setIsAiLoading(false);
    }
  }, [cash, loanBalance, maintenanceLimit, holdings, cashNeed, marketDropPct, selectedProvider, selectedModel]);

  useEffect(() => {
    if (holdings.length > 0) void runOptimization();
    else setProposal(null);
  }, [runOptimization, holdings.length]);

  // Approve & Execute — persists the simulated rebalance to the DB (dry-run of the pipeline)
  const handleApproveRebalance = useCallback(async () => {
    if (!proposal || proposal.proposed_lots_to_sell.length === 0) return;

    setIsSaving(true);
    try {
      let totalProceeds = 0;
      const updatedHoldings = holdings
        .map((lot) => {
          const proposed = proposal.proposed_lots_to_sell.find((p) => p.lot_id === lot.id);
          if (proposed) {
            totalProceeds += proposed.est_proceeds;
            return { ...lot, quantity: Math.max(0, lot.quantity - proposed.quantity) };
          }
          return lot;
        })
        .filter((lot) => lot.quantity > 0.0001);

      const shortfall = proposal.headroom_dollars < 0 ? Math.abs(proposal.headroom_dollars) : 0;
      const h_proforma = proposal.headroom_dollars - cashNeed * maintenanceLimit;
      let paydown_needed = 0;
      if (h_proforma < 0) {
        paydown_needed = Math.abs(h_proforma) / (1 - maintenanceLimit);
      }
      const paydownAmount = Math.min(paydown_needed, totalProceeds);
      const newLoanBalance = Math.max(0, parseFloat((loanBalance - paydownAmount).toFixed(2)));

      // Persist each quantity change
      for (const lot of updatedHoldings) {
        const original = holdings.find((h) => h.id === lot.id);
        if (original && lot.holdingId && Math.abs(original.quantity - lot.quantity) > 0.0001) {
          await safeApi(`/api/portfolio/holdings/${lot.holdingId}`, {
            method: "PATCH",
            body: JSON.stringify({ lotId: lot.id, quantity: lot.quantity }),
          });
        }
      }
      // Remove fully-sold lots
      for (const lot of holdings) {
        if (!updatedHoldings.some((u) => u.id === lot.id) && lot.holdingId) {
          await safeApi(`/api/portfolio/holdings/${lot.holdingId}`, { method: "DELETE" });
        }
      }
      await safeApi("/api/portfolio", { method: "PATCH", body: JSON.stringify({ loanBalance: newLoanBalance }) });

      setCashNeed(0);
      setMarketDropPct(0);
      await loadPortfolio();
    } catch (err) {
      console.error("Approve rebalance failed:", err);
    } finally {
      setIsSaving(false);
    }
  }, [proposal, holdings, loanBalance, cashNeed, maintenanceLimit, loadPortfolio]);

  const collateralValue = holdings.reduce((sum, h) => {
    const price = h.current_price * (1 - marketDropPct / 100);
    return sum + h.quantity * price;
  }, 0);

  const selectedProviderName = registry?.providers.find((p) => p.id === selectedProvider)?.name || selectedProvider;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-white/40 font-mono text-xs animate-pulse">Checking session…</div>
      </div>
    );
  }
  if (!user) {
    navigate("/", { replace: true });
    return null;
  }

  const accountSnapshot: AccountSnapshot = {
    cash,
    loan_balance: loanBalance,
    maintenance_ltv_limit: maintenanceLimit,
    holdings,
  };

  return (
    <div className="min-h-screen bg-surface text-[#E0E0E0] pb-16 font-sans selection:bg-white/20 selection:text-white">
      {/* Global Margin Status Header Alert */}
      {proposal && proposal.headroom_dollars < 0 && (
        <div
          id="global-margin-call-banner"
          className="bg-rose-950/90 text-rose-200 border-b border-rose-500/30 px-6 py-4 flex items-center justify-between shadow-[0_4px_20px_rgba(244,63,94,0.15)] text-xs font-semibold animate-pulse"
        >
          <div className="flex items-center gap-3">
            <span className="p-1 bg-rose-500/20 border border-rose-500/30 rounded text-rose-400">
              <AlertOctagon size={16} />
            </span>
            <span>
              <strong className="text-rose-400 uppercase tracking-wide">Urgent Margin Deficit:</strong> LTV limit is currently
              breached! Deficit of{" "}
              <strong className="font-mono text-white">
                ${Math.abs(proposal.headroom_dollars).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </strong>{" "}
              requires immediate trade liquidation.
            </span>
          </div>
          <a
            href="#optimizer-proposal-container"
            className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded font-medium transition shrink-0 shadow-lg text-[11px] uppercase tracking-wider"
          >
            Review Proposal
          </a>
        </div>
      )}

      {/* Header */}
      <header className="bg-platter border-b border-line px-6 py-5 sticky top-0 z-40 backdrop-blur-md bg-opacity-90">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-bold text-black shadow-lg shadow-white/5">
              C
            </div>
            <div>
              <h1 className="font-sans font-medium text-lg text-white tracking-tight flex items-center gap-2">
                Collateral Dashboard
              </h1>
              <p className="text-xs text-white/40">
                Signed in as <span className="text-white/60 font-mono">{user.email}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-xs font-mono text-white/40">
            <div className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  proposal && proposal.headroom_dollars < 0
                    ? "bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-ping"
                    : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                }`}
              ></div>
              <span
                className={`font-bold uppercase tracking-wider text-[10px] ${
                  proposal && proposal.headroom_dollars < 0 ? "text-rose-500" : "text-emerald-500"
                }`}
              >
                {proposal && proposal.headroom_dollars < 0 ? "High Risk / Margin Call" : "System Status: Nominal"}
              </span>
            </div>
            <a href="/stocks" className="flex items-center gap-1.5 border-l border-line pl-4 text-white/60 hover:text-white transition">
              <Activity size={13} /> Stocks
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 mt-8 flex flex-col gap-8">
        {loadingPortfolio ? (
          <div className="flex items-center justify-center py-20 text-white/40 font-mono text-xs gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading your portfolio…
          </div>
        ) : portfolioError ? (
          <div className="bg-rose-950/40 border border-rose-500/25 text-rose-200 rounded-2xl p-6 text-sm">
            {portfolioError} — <a href="/" className="underline">sign out</a>
          </div>
        ) : holdings.length === 0 ? (
          <EmptyState
            onAddHolding={handleAddHolding}
            cash={cash}
            loanBalance={loanBalance}
            maintenanceLimit={maintenanceLimit}
            onCashChange={(v) => { setCash(v); persistAccountProps({ cash: v }); }}
            onLoanChange={(v) => { setLoanBalance(v); persistAccountProps({ loanBalance: v }); }}
            onLimitChange={(v) => { setMaintenanceLimit(v); persistAccountProps({ maintenanceLtvLimit: v }); }}
            isSaving={isSaving}
          />
        ) : (
          <>
            {/* AI Model Selector Card */}
            <section className="bg-platter border border-line rounded-2xl p-6 shadow-xl">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b border-line">
                <div className="flex items-center gap-2.5">
                  <span className="p-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg">
                    <Sparkles size={16} />
                  </span>
                  <div>
                    <h2 className="font-sans font-medium text-sm text-white">AI Model Engine</h2>
                    <p className="text-xs text-white/40">Select the intelligence provider &amp; model for portfolio analysis</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full uppercase tracking-wider">
                    Active: {selectedProviderName} / {selectedModel}
                  </span>
                  <button
                    onClick={() => setShowModelManager(!showModelManager)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-line hover:border-white/30 text-white/70 hover:text-white rounded-lg text-[11px] font-medium uppercase tracking-wider transition cursor-pointer"
                  >
                    <Settings2 size={12} />
                    {showModelManager ? "Done" : "Manage Models"}
                  </button>
                </div>
              </div>

              {registry &&
                registry.providers.map((provider) => (
                  <div key={provider.id} className="mb-4 last:mb-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-white/40">{provider.name}</span>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider border ${
                          provider.hasKey
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                        }`}
                      >
                        {provider.hasKey ? "key ready" : "no key"}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                      {provider.models.map((m) => {
                        const isSelected = selectedProvider === provider.id && selectedModel === m.id;
                        return (
                          <button
                            key={`${provider.id}-${m.id}`}
                            id={`model-select-${m.id}`}
                            onClick={() => {
                              setSelectedProvider(provider.id);
                              setSelectedModel(m.id);
                            }}
                            className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer group ${
                              isSelected
                                ? "border-amber-400/80 bg-amber-500/10 shadow-lg ring-1 ring-amber-400/30 text-white"
                                : "border-white/5 bg-platter/60 hover:bg-platter hover:border-white/15 text-white/70"
                            }`}
                          >
                            <div>
                              <span className={`font-mono text-xs font-bold truncate ${isSelected ? "text-amber-300" : "text-white"}`}>
                                {m.name}
                              </span>
                              <p className="text-[11px] text-white/40 leading-snug line-clamp-2 mt-1">{m.desc || m.id}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

              {showModelManager && registry && (
                <ModelManager
                  registry={registry}
                  onChange={(next) => {
                    setRegistry(next);
                    setSelectedProvider(next.defaultProvider);
                    setSelectedModel(next.defaultModel);
                  }}
                />
              )}
            </section>

            {/* Dashboard Workstation Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column: Account Settings & Simulation Sliders */}
              <div className="lg:col-span-1 flex flex-col gap-8">
                <div className="bg-platter border border-line rounded-2xl p-6 shadow-xl flex flex-col gap-5">
                  <div>
                    <h3 className="font-sans font-medium text-xs text-white/50 uppercase tracking-widest font-mono">
                      Margin Account Properties
                    </h3>
                    <p className="text-xs text-white/40 mt-1">Saved to your portfolio</p>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1.5 font-mono">Cash Balance ($)</label>
                    <input
                      type="number"
                      value={cash}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) || 0;
                        setCash(v);
                        persistAccountProps({ cash: v });
                      }}
                      className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2.5 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/10 transition-all font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1.5 font-mono">Active Loan Balance ($)</label>
                    <input
                      type="number"
                      value={loanBalance}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) || 0;
                        setLoanBalance(v);
                        persistAccountProps({ loanBalance: v });
                      }}
                      className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2.5 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/10 transition-all font-mono"
                    />
                  </div>
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
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setMaintenanceLimit(v);
                        persistAccountProps({ maintenanceLtvLimit: v });
                      }}
                      className="w-full accent-white cursor-pointer"
                    />
                  </div>
                </div>

                <div className="bg-platter border border-line rounded-2xl p-6 shadow-xl flex flex-col gap-6">
                  <div>
                    <h3 className="font-sans font-medium text-xs text-white/50 uppercase tracking-widest font-mono">Scenario Simulations</h3>
                    <p className="text-xs text-white/40 mt-1">Simulate liquidity needs &amp; price falls</p>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-[10px] uppercase tracking-wider text-white/50 font-mono flex items-center gap-1.5">
                        <Coins size={12} className="text-white/40" /> Requested Cash Liquidity
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
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-[10px] uppercase tracking-wider text-rose-400 font-mono flex items-center gap-1.5">
                        <TrendingDown size={12} className="text-rose-400" /> Market Shock Drop
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

              {/* Right Column */}
              <div className="lg:col-span-2 flex flex-col gap-8">
                <HoldingsTable
                  holdings={holdings}
                  proposedLots={proposal?.proposed_lots_to_sell || []}
                  onAddHolding={handleAddHolding}
                  onUpdateLot={handleUpdateLot}
                  onDeleteLot={handleDeleteLot}
                  onRefreshPrices={() => refreshPrices(holdings.map((h) => h.symbol))}
                  isRefreshingPrices={isRefreshingPrices}
                  isSaving={isSaving}
                />

                <OptimizationProposal
                  proposal={proposal}
                  aiRationale={aiRationale}
                  onApprove={handleApproveRebalance}
                  isLoading={isAiLoading}
                  selectedModel={selectedModel}
                  provider={aiProvider}
                />

                <ChatAssistant
                  currentSnapshot={accountSnapshot}
                  cashNeed={cashNeed}
                  marketEventDescription={marketDropPct > 0 ? `Portfolio fell ${marketDropPct}%` : ""}
                  selectedModel={selectedModel}
                  provider={selectedProvider}
                />
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="mt-20 border-t border-line bg-platter/50 py-10 text-center text-xs text-white/30 font-mono">
        <div className="max-w-7xl mx-auto px-8 flex flex-col items-center gap-3">
          <span>© 2026 Collateral — Portfolio Liquidity &amp; Tax Optimizer Agent</span>
          <span className="max-w-2xl leading-relaxed text-[11px] text-white/50 font-sans mt-1">
            <strong>Disclaimer:</strong> This application is a monitoring and planning tool. The agent is not a licensed
            financial or tax advisor and its outputs are not individualized investment or tax advice. Every proposed
            transaction must pass through your approval before any order is simulated.
          </span>
        </div>
      </footer>
    </div>
  );
}

function EmptyState({
  onAddHolding,
  cash,
  loanBalance,
  maintenanceLimit,
  onCashChange,
  onLoanChange,
  onLimitChange,
  isSaving,
}: {
  onAddHolding: (data: HoldingInput) => Promise<void>;
  cash: number;
  loanBalance: number;
  maintenanceLimit: number;
  onCashChange: (v: number) => void;
  onLoanChange: (v: number) => void;
  onLimitChange: (v: number) => void;
  isSaving: boolean;
}) {
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [acquiredDate, setAcquiredDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim() || !quantity || !costBasis) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAddHolding({
        symbol: symbol.toUpperCase(),
        quantity: parseFloat(quantity),
        costBasis: parseFloat(costBasis),
        acquiredAt: acquiredDate,
      });
    } catch (err: any) {
      setError(err?.message || "Could not add holding.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-platter border border-line rounded-3xl p-8 md:p-10 shadow-xl">
      <span className="p-3 bg-white/5 border border-line text-white/70 rounded-2xl inline-flex">
        <HelpCircle size={20} />
      </span>
      <h2 className="mt-5 text-2xl font-light text-white tracking-tight">Add your first holding to get started</h2>
      <p className="mt-2 text-sm text-white/50 leading-relaxed">
        Enter a position you actually own. It&apos;s saved to your account and will still be here next time you sign in.
        Live prices are fetched from yfinance for your symbols.
      </p>

      <div className="mt-6 bg-platter border border-line rounded-2xl p-5">
        <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-widest font-mono mb-4">Position details</h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Symbol</label>
            <input
              type="text"
              placeholder="e.g. AAPL"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2.5 focus:outline-none focus:border-white/30 font-mono"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Quantity</label>
            <input
              type="number"
              step="any"
              placeholder="10"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2.5 focus:outline-none focus:border-white/30 font-mono"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Cost Basis ($/share)</label>
            <input
              type="number"
              step="any"
              placeholder="200.00"
              value={costBasis}
              onChange={(e) => setCostBasis(e.target.value)}
              className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2.5 focus:outline-none focus:border-white/30 font-mono"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Acquired Date</label>
            <input
              type="date"
              value={acquiredDate}
              onChange={(e) => setAcquiredDate(e.target.value)}
              className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2.5 focus:outline-none focus:border-white/30 font-mono text-white/80"
              required
            />
          </div>
          {error && (
            <div className="sm:col-span-2 text-rose-400 text-xs font-mono bg-rose-500/5 border border-rose-500/20 rounded-lg p-2.5">
              {error}
            </div>
          )}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={submitting || isSaving}
              className="w-full flex items-center justify-center gap-2 py-3 bg-white text-black rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-white/90 transition cursor-pointer disabled:opacity-50"
            >
              {submitting || isSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {submitting || isSaving ? "Saving…" : "Add holding"}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-5 bg-platter border border-line rounded-2xl p-5">
        <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-widest font-mono mb-4">Loan account (optional)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Cash ($)</label>
            <input
              type="number"
              value={cash}
              onChange={(e) => onCashChange(parseFloat(e.target.value) || 0)}
              className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2.5 focus:outline-none focus:border-white/30 font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">Loan Balance ($)</label>
            <input
              type="number"
              value={loanBalance}
              onChange={(e) => onLoanChange(parseFloat(e.target.value) || 0)}
              className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2.5 focus:outline-none focus:border-white/30 font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5 font-mono">LTV Limit</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.10"
                max="0.80"
                step="0.05"
                value={maintenanceLimit}
                onChange={(e) => onLimitChange(parseFloat(e.target.value))}
                className="flex-1 accent-white cursor-pointer"
              />
              <span className="text-xs font-bold text-white font-mono w-8 text-right">{(maintenanceLimit * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}