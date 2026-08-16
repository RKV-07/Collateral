import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Activity, RefreshCw, Loader2, TrendingUp, TrendingDown, ArrowLeft, Wallet } from "lucide-react";
import { api, ApiError, PortfolioDTO, PriceInfo } from "../api";
import { useAuth } from "../useAuth";

interface StockRow {
  symbol: string;
  quantity: number;
  price: number | null;
  dayChange?: number;
  dayChangePct?: number;
  value: number;
}

async function safeApi<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) window.location.href = "/";
    throw err;
  }
}

export default function Stocks() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState<PortfolioDTO | null>(null);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await safeApi<{ portfolio: PortfolioDTO }>("/api/portfolio");
      setPortfolio(data.portfolio);
      setError(null);
      return data.portfolio;
    } catch (err: any) {
      setError(err?.message || "Failed to load portfolio.");
      return null;
    }
  }, []);

  const refreshPrices = useCallback(async (pf: PortfolioDTO) => {
    const symbols = pf.holdings.map((h) => h.symbol);
    if (symbols.length === 0) {
      setRows([]);
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    try {
      const data = await safeApi<{ prices: Record<string, PriceInfo> }>("/api/portfolio/prices", {
        method: "POST",
        body: JSON.stringify({ symbols }),
      });
      setPrices((prev) => ({ ...prev, ...data.prices }));
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Price refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/", { replace: true });
      return;
    }
    (async () => {
      setLoading(true);
      const pf = await load();
      if (pf) await refreshPrices(pf);
      setLoading(false);
    })();
  }, [authLoading, user, navigate, load, refreshPrices]);

  useEffect(() => {
    if (!portfolio || portfolio.holdings.length === 0) return;
    const t = setInterval(() => refreshPrices(portfolio), 60_000);
    return () => clearInterval(t);
  }, [portfolio, refreshPrices]);

  useEffect(() => {
    if (!portfolio) {
      setRows([]);
      return;
    }
    const map = new Map<string, number>();
    for (const h of portfolio.holdings) {
      let q = map.get(h.symbol) || 0;
      for (const lot of h.lots) q += lot.quantity;
      map.set(h.symbol, q);
    }
    const next: StockRow[] = [...map.entries()].map(([symbol, quantity]) => {
      const p = prices[symbol];
      return {
        symbol,
        quantity,
        price: p?.price ?? null,
        dayChange: p?.dayChange,
        dayChangePct: p?.dayChangePct,
        value: p?.price ? quantity * p.price : 0,
      };
    });
    setRows(next);
  }, [portfolio, prices]);

  const totalValue = rows.reduce((sum, r) => sum + r.value, 0);
  const gainers = rows.filter((r) => (r.dayChange ?? 0) >= 0);
  const losers = rows.filter((r) => (r.dayChange ?? 0) < 0);
  const priceSource = rows.some((r) => r.price !== null) ? "yfinance" : null;

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-white/40 font-mono text-xs animate-pulse flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading your symbols…
        </div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="min-h-screen bg-surface text-[#E0E0E0] pb-16 font-sans selection:bg-white/20 selection:text-white">
      <header className="bg-platter border-b border-line px-6 py-5 sticky top-0 z-40 backdrop-blur-md bg-opacity-90">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <Link to="/dashboard" className="p-2 text-white/40 hover:text-white border border-line rounded-lg transition">
              <ArrowLeft size={15} />
            </Link>
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-bold text-black">C</div>
            <div>
              <h1 className="font-sans font-medium text-lg text-white tracking-tight flex items-center gap-2">
                Stocks <span className="text-xs text-white/30 font-mono">/ live prices</span>
              </h1>
              <p className="text-xs text-white/40 font-mono">
                {rows.length} symbol{rows.length === 1 ? "" : "s"} · {user.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Not yet updated"}
              {priceSource ? ` · ${priceSource}` : ""}
            </span>
            <button
              onClick={() => portfolio && refreshPrices(portfolio)}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-white/90 transition cursor-pointer disabled:opacity-40"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh prices"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 mt-8 flex flex-col gap-8">
        {error && (
          <div className="bg-rose-950/40 border border-rose-500/25 text-rose-200 rounded-2xl p-5 text-sm">{error}</div>
        )}

        {rows.length === 0 && !error ? (
          <div className="max-w-xl mx-auto text-center bg-platter border border-line rounded-3xl p-10">
            <span className="p-3 bg-white/5 border border-line text-white/70 rounded-2xl inline-flex">
              <Activity size={20} />
            </span>
            <h2 className="mt-5 text-xl font-light text-white tracking-tight">Nothing to watch yet.</h2>
            <p className="mt-2 text-sm text-white/50">
              The Stocks page shows live yfinance prices for the symbols in your portfolio. Add your first holding on the
              dashboard to see it here.
            </p>
            <Link
              to="/dashboard"
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-white/90 transition"
            >
              Go to dashboard
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-platter border border-line rounded-2xl p-5">
                <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                  <Wallet size={12} /> Total position value
                </span>
                <p className="mt-2 text-2xl font-light text-white font-mono">
                  ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-platter border border-emerald-500/15 rounded-2xl p-5">
                <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                  <TrendingUp size={12} className="text-emerald-400" /> Up today
                </span>
                <p className="mt-2 text-2xl font-light text-emerald-400 font-mono">{gainers.length}</p>
              </div>
              <div className="bg-platter border border-rose-500/15 rounded-2xl p-5">
                <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                  <TrendingDown size={12} className="text-rose-400" /> Down today
                </span>
                <p className="mt-2 text-2xl font-light text-rose-400 font-mono">{losers.length}</p>
              </div>
            </div>

            <div className="bg-platter border border-line rounded-2xl p-6 shadow-xl">
              <div className="flex justify-between items-center mb-5">
                <div>
                  <h2 className="font-medium text-sm text-white">Holdings — live prices</h2>
                  <p className="text-xs text-white/40 font-mono mt-1">60s server-side cache per symbol</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-line text-left text-[10px] uppercase text-white/40 font-mono tracking-wider">
                      <th className="pb-3 pl-2">Symbol</th>
                      <th className="pb-3 text-right">Quantity</th>
                      <th className="pb-3 text-right">Current price</th>
                      <th className="pb-3 text-right">Day change</th>
                      <th className="pb-3 text-right pr-2">Position value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const up = (r.dayChange ?? 0) >= 0;
                      return (
                        <tr key={r.symbol} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-4 pl-2">
                            <span className="font-medium text-white text-sm tracking-tight">{r.symbol}</span>
                          </td>
                          <td className="py-4 text-right text-xs text-white/70 font-mono">
                            {r.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          </td>
                          <td className="py-4 text-right text-xs text-white font-mono">
                            {r.price !== null ? `$${r.price.toFixed(2)}` : (
                              <span className="text-white/30">unavailable</span>
                            )}
                          </td>
                          <td className="py-4 text-right">
                            {r.dayChange !== undefined ? (
                              <span className={`text-xs font-mono font-semibold ${up ? "text-emerald-400" : "text-rose-400"}`}>
                                {up ? "+" : ""}
                                ${Math.abs(r.dayChange).toFixed(2)}
                                <span className="text-white/30"> ({up ? "+" : ""}
                                {r.dayChangePct?.toFixed(2)}%)</span>
                              </span>
                            ) : (
                              <span className="text-xs text-white/20">—</span>
                            )}
                          </td>
                          <td className="py-4 pr-2 text-right text-xs font-semibold text-white font-mono">
                            {r.price !== null
                              ? `$${r.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}