import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Activity, BellRing, Scale, FileText, UserCheck, ArrowRight, AlertTriangle } from "lucide-react";
import { useAuth } from "../useAuth";

export default function Home() {
  const { user, loading } = useAuth();
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const oauthError = params.get("error") === "oauth_not_configured";

  const CTA = loading ? (
    <span className="text-white/40 font-mono animate-pulse">Loading…</span>
  ) : user ? (
    <Link
      to="/dashboard"
      className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black rounded-xl text-sm font-bold uppercase tracking-wider hover:bg-white/90 transition shadow-lg cursor-pointer"
    >
      <ArrowRight size={16} />
      Open your dashboard
    </Link>
  ) : (
    <div className="flex flex-col sm:flex-row items-center gap-3">
      <a
        href="/auth/google"
        className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black rounded-xl text-sm font-bold uppercase tracking-wider hover:bg-white/90 transition shadow-lg cursor-pointer"
      >
        <ShieldCheck size={16} />
        Sign in with Google
      </a>
      <Link
        to="/login"
        className="inline-flex items-center gap-2 px-6 py-3 bg-white/5 border border-line text-white/80 hover:text-white rounded-xl text-sm font-bold uppercase tracking-wider transition cursor-pointer"
      >
        Sign in with email
      </Link>
      <a
        href="/demo"
        className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500/10 border border-amber-500/30 hover:border-amber-400 text-amber-200 rounded-xl text-sm font-bold uppercase tracking-wider transition cursor-pointer"
      >
        Try the live demo
      </a>
    </div>
  );

  return (
    <div>
      {/* OAuth not configured notice */}
      {oauthError && (
        <div className="max-w-4xl mx-auto mt-6 px-6">
          <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 text-amber-200 text-sm">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <strong>Google OAuth is not configured yet.</strong> Set <code className="font-mono bg-black/30 px-1 rounded">GOOGLE_CLIENT_ID</code>,
              <code className="font-mono bg-black/30 px-1 rounded">GOOGLE_CLIENT_SECRET</code> and <code className="font-mono bg-black/30 px-1 rounded">APP_URL</code>
              in <code className="font-mono bg-black/30 px-1 rounded">.env.local</code>, then restart the server.
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-14 text-center">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-line bg-white/5 text-[10px] font-mono text-white/50 uppercase tracking-widest mb-6">
          <Activity size={11} className="text-emerald-400" />
          LTV monitoring · Slack alerts · Tax-lot ranking
        </span>
        <h1 className="text-4xl md:text-6xl font-light tracking-tight text-white leading-tight">
          The watchman between you and a{" "}
          <span className="text-rose-400">margin call</span>.
        </h1>
        <p className="mt-6 text-lg text-white/60 leading-relaxed max-w-2xl mx-auto">
          Collateral watches your collateral-to-loan ratio, alerts you the instant a margin call is near, and tells you — in
          plain English — which shares to sell first so a forced liquidation harvests the biggest tax loss instead of the
          biggest tax bill.
        </p>
        <div className="mt-9 flex justify-center">{CTA}</div>
      </section>

      {/* The problem */}
      <section className="border-t border-white/5 bg-platter/40">
        <div className="max-w-4xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-2xl md:text-3xl font-light text-white tracking-tight">
              You borrowed against your stocks. Your shares are the house.
            </h2>
            <p className="mt-4 text-white/60 leading-relaxed text-sm">
              Your bank agreed to lend you up to half the value of your portfolio. Then the market dips. Your shares shrink,
              your loan doesn&apos;t, and the ratio creeps toward the limit.
            </p>
            <p className="mt-3 text-white/60 leading-relaxed text-sm">
              Cross that line and the bank doesn&apos;t call for a chat. It issues a <strong className="text-rose-300">margin call</strong>:
              post more money — or we sell your shares at whatever price we can get. Forced selling at the worst prices, with
              the tax bill landing exactly when you can least afford it.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {[
              {
                icon: Scale,
                title: "Measured",
                text: "Your loan-to-value ratio and headroom are recomputed every time prices move — deterministic math, not guesses.",
              },
              {
                icon: BellRing,
                title: "Alerted",
                text: "A Slack ping fires the moment you cross into High Risk, before anyone has to ask.",
              },
              {
                icon: FileText,
                title: "Explained",
                text: "When a sale is genuinely necessary, AI explains in plain English which lots to sell and why.",
              },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-4 bg-platter border border-line rounded-2xl p-5">
                <span className="p-2.5 bg-white/5 text-white/80 rounded-xl border border-line shrink-0">
                  <f.icon size={18} />
                </span>
                <div>
                  <h3 className="text-sm font-medium text-white">{f.title}</h3>
                  <p className="text-xs text-white/50 mt-1 leading-relaxed">{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Human in the loop */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <div className="bg-gradient-to-br from-[#161618] to-[#111113] border border-line rounded-3xl p-8 md:p-10 text-center">
          <span className="mx-auto p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl inline-flex">
            <UserCheck size={20} />
          </span>
          <h2 className="mt-4 text-2xl font-light text-white tracking-tight">The agent proposes. You approve.</h2>
          <p className="mt-3 text-sm text-white/55 max-w-xl mx-auto leading-relaxed">
            Collateral uses mathematics as the source of truth and AI as the explainer. Every proposed trade pauses for your
            explicit approval, and every decision is appended to a compliance-ready audit trail you can export. No automated
            trading. Ever.
          </p>
          <div className="mt-7 flex justify-center">{CTA}</div>
        </div>
      </section>
    </div>
  );
}