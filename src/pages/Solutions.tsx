import React from "react";
import { Link } from "react-router-dom";
import { Droplets, Hash, TrendingUp, Activity, BellRing, Scale, ArrowRight, AlertOctagon } from "lucide-react";
import { useAuth } from "../useAuth";

export default function Solutions() {
  const { user, loading } = useAuth();

  const problems = [
    {
      icon: Droplets,
      title: "Fragmented liquidity",
      problem:
        "Cash is tied up across scattered holdings and strategies, so raising it on short notice means selling whatever comes to hand — often at the worst time.",
      feature: {
        name: "Live LTV monitor",
        icon: Activity,
        text: "Collateral consolidates every position and recomputes your collateral value, loan-to-value ratio, and borrowing headroom on every price tick, so you always know your actual cash-raising capacity.",
      },
    },
    {
      icon: Hash,
      title: "Manual LTV tracking",
      problem:
        "Most borrowers watch their loan-to-value ratio on a spreadsheet they update occasionally — or not at all, until the brokerage's automated message arrives.",
      feature: {
        name: "Slack alerts",
        icon: BellRing,
        text: "The moment you cross into High Risk, Collateral fires a proactive Slack notification. It watches for you, so a silent drift toward the limit is never a surprise.",
      },
    },
    {
      icon: TrendingUp,
      title: "Tax-inefficient rebalancing",
      problem:
        "When a liquidation is unavoidable, brokers sell collateral however it's held — realising avoidable taxable gains exactly when you can afford them least.",
      feature: {
        name: "Tax-lot ranking",
        icon: Scale,
        text: "Collateral ranks your tax lots (losses before gains, short-term before long-term), flags wash-sale risk under IRC §1091, and sizes the sale with the shrinking-collateral formula.",
      },
    },
  ];

  const CTA = loading ? (
    <span className="text-white/40 font-mono animate-pulse">Loading…</span>
  ) : user ? (
    <Link
      to="/dashboard"
      className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-white/90 transition cursor-pointer"
    >
      Open your dashboard <ArrowRight size={14} />
    </Link>
  ) : (
    <a
      href="/auth/google"
      className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-white/90 transition cursor-pointer"
    >
      Sign in with Google <ArrowRight size={14} />
    </a>
  );

  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      <div className="text-center max-w-2xl mx-auto">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-line bg-white/5 text-[10px] font-mono text-white/50 uppercase tracking-widest mb-6">
          <AlertOctagon size={11} className="text-rose-400" />
          Three ways Collateral protects you
        </span>
        <h1 className="text-3xl md:text-4xl font-light text-white tracking-tight">Problems it solves, and the tool that solves them</h1>
        <p className="mt-4 text-white/55 text-sm leading-relaxed">
          Margin lending is how retail investors and small firms access capital without selling assets. Collateral automates the
          monitoring, sizing, and explanation layer that today is manual, spreadsheet-driven, and opaque.
        </p>
      </div>

      <div className="mt-14 flex flex-col gap-10">
        {problems.map((p) => (
          <div key={p.title} className="grid md:grid-cols-2 gap-8 items-center bg-platter border border-line rounded-3xl p-8">
            <div>
              <span className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl inline-flex">
                <p.icon size={20} />
              </span>
              <h2 className="mt-4 text-xl font-medium text-white tracking-tight">{p.title}</h2>
              <p className="mt-2 text-sm text-white/55 leading-relaxed">{p.problem}</p>
            </div>
            <div className="bg-platter border border-emerald-500/15 rounded-2xl p-5">
              <span className="inline-flex items-center gap-2 text-emerald-300 text-[10px] font-bold uppercase tracking-widest font-mono">
                <p.feature.icon size={13} /> The fix — {p.feature.name}
              </span>
              <p className="mt-3 text-sm text-white/65 leading-relaxed">{p.feature.text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-14 text-center">{CTA}</div>
    </div>
  );
}