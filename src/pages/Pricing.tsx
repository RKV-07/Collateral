import React from "react";
import { Check, Info } from "lucide-react";

export default function Pricing() {
  const tiers = [
    {
      name: "Free",
      price: "$0",
      cadence: "forever",
      tagline: "Track one portfolio and see how a margin call would play out before it happens.",
      features: ["1 portfolio", "Manual price refresh", "LTV monitor & optimizer", "AI rationale & chat"],
      highlighted: false,
    },
    {
      name: "Pro",
      price: "~$15",
      cadence: "/ month",
      tagline: "For people who borrow against real money and want the watchman on duty around the clock.",
      features: [
        "Live monitoring & automatic refresh",
        "Slack margin-call alerts",
        "Audit export (compliance-ready JSON)",
        "Unlimited holdings & portfolios",
      ],
      highlighted: true,
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-light text-white tracking-tight">Simple pricing. No surprises.</h1>
        <p className="mt-4 text-white/55 text-sm leading-relaxed">
          Underlying margin lending has no paid cloud dependency — this app self-hosts on your own infrastructure. It costs
          us get close to nothing to run, so it costs you little to use.
        </p>
      </div>

      <div className="mt-12 grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
        {tiers.map((t) => (
          <div
            key={t.name}
            className={`rounded-3xl border p-8 flex flex-col ${
              t.highlighted
                ? "border-amber-400/40 bg-gradient-to-b from-amber-500/10 to-[#111113] shadow-xl"
                : "border-line bg-platter"
            }`}
          >
            <h2 className="text-lg font-medium text-white tracking-tight">{t.name}</h2>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-4xl font-light text-white">{t.price}</span>
              <span className="text-sm text-white/40 font-mono">{t.cadence}</span>
            </div>
            <p className="mt-3 text-sm text-white/55 leading-relaxed">{t.tagline}</p>
            <ul className="mt-6 flex flex-col gap-3 flex-1">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-white/70">
                  <Check size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-8 flex items-start gap-3 justify-center max-w-2xl mx-auto bg-amber-500/5 border border-amber-500/15 rounded-2xl p-4 text-amber-200/90 text-xs leading-relaxed">
        <Info size={15} className="shrink-0 mt-0.5" />
        <p>
          <strong>Coming soon — invite only.</strong> We are not collecting payment yet. Every account is free while we
          harden the product, and Pro pricing above is a placeholder; the final number will be set before billing exists.
        </p>
      </div>
    </div>
  );
}