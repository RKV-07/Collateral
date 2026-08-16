import React, { useEffect, useState } from "react";
import {
  Users,
  Briefcase,
  FileCheck2,
  Database,
  Activity,
  ShieldCheck,
  Server,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { api } from "../api";

interface AdminSummary {
  counts: { users: number; portfolios: number; holdings: number; audits: number; admins: number; sessions: number };
  usage: { analyze: number; chat: number; audit: number; prices: number; since: string };
  provider_breakdown: Record<string, number>;
  risk_breakdown: Record<string, number>;
}

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  portfolios: { id: string; cash: number; loanBalance: number; maintenanceLtvLimit: number; holdings: number; updatedAt: string }[];
  lastAudit: string | null;
}

interface AdminAuditRecord {
  id: number;
  timestamp: string;
  userId: string | null;
  riskState: string;
  currentLtv: number;
  headroom: number;
  recommendedAction: string;
  approved: boolean;
  status: string;
  provider: string;
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-platter border border-line rounded-2xl p-5">
      <div className="flex items-center gap-3">
        <span className="p-2.5 bg-white/5 text-white/80 rounded-xl border border-line">
          <Icon size={16} />
        </span>
        <div>
          <div className="text-2xl font-light text-white leading-none">{value}</div>
          <div className="text-[11px] font-mono text-white/40 mt-1">{label}</div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium text-white/80 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </div>
  );
}

export default function Admin() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [audits, setAudits] = useState<AdminAuditRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, u, a] = await Promise.all([
          api<AdminSummary>("/api/admin/summary"),
          api<{ users: AdminUser[] }>("/api/admin/users"),
          api<{ records: AdminAuditRecord[] }>("/api/admin/audit?limit=100"),
        ]);
        setSummary(s);
        setUsers(u.users);
        setAudits(a.records);
      } catch (err: any) {
        setError(err.message || "Failed to load admin data");
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-surface text-[#E0E0E0] font-sans flex items-center justify-center px-6">
        <div className="flex items-start gap-3 bg-rose-500/10 border border-rose-500/25 rounded-xl p-4 text-rose-200 text-sm max-w-md">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div>
            <strong>Admin panel error.</strong> {error}
          </div>
        </div>
      </div>
    );
  }

  if (!summary || !users || !audits) {
    return (
      <div className="min-h-screen bg-surface text-[#E0E0E0] font-sans flex items-center justify-center">
        <div className="text-white/40 font-mono text-xs animate-pulse flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Loading admin dashboard…
        </div>
      </div>
    );
  }

  const providerTotal = Object.values(summary.provider_breakdown).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="min-h-screen bg-surface text-[#E0E0E0] font-sans px-6 py-10">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <span className="p-3 bg-white/5 text-white/90 rounded-2xl border border-line">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-light text-white tracking-tight">Admin Dashboard</h1>
            <p className="text-xs font-mono text-white/40">Full-system view — users, audit trail, AI usage</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard icon={Users} label="Users" value={summary.counts.users} />
          <StatCard icon={Briefcase} label="Portfolios" value={summary.counts.portfolios} />
          <StatCard icon={FileCheck2} label="Audit records" value={summary.counts.audits} />
          <StatCard icon={Database} label="Holdings" value={summary.counts.holdings} />
          <StatCard icon={ShieldCheck} label="Admins" value={summary.counts.admins} />
          <StatCard icon={Server} label="Active sessions" value={summary.counts.sessions} />
        </div>

        <Section title="AI usage (since server boot)">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={Activity} label="Analyses" value={summary.usage.analyze} />
            <StatCard icon={Activity} label="Chat turns" value={summary.usage.chat} />
            <StatCard icon={Activity} label="Audit exports" value={summary.usage.audit} />
            <StatCard icon={Activity} label="Price fetches" value={summary.usage.prices} />
          </div>
          <p className="text-[11px] font-mono text-white/30 mt-2">Since {summary.usage.since}</p>
        </Section>

        <Section title="Provider breakdown (last 500 audits)">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(summary.provider_breakdown).map(([provider, count]) => (
              <div key={provider} className="bg-platter border border-line rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-white/50">{provider}</span>
                  <span className="text-sm font-medium text-white">{count}</span>
                </div>
                <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400/80 rounded-full" style={{ width: `${(count / providerTotal) * 100}%` }} />
                </div>
              </div>
            ))}
            {Object.keys(summary.provider_breakdown).length === 0 && (
              <p className="text-xs text-white/30">No audit records yet.</p>
            )}
          </div>
        </Section>

        <Section title={`Users (${users.length})`}>
          <div className="bg-platter border border-line rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-white/40 font-mono border-b border-line">
                <tr>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Portfolios</th>
                  <th className="px-4 py-3 font-medium">Holdings</th>
                  <th className="px-4 py-3 font-medium">Loan balance</th>
                  <th className="px-4 py-3 font-medium">Last audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white/80">
                      {u.email}
                      {u.role === "ADMIN" && (
                        <span className="ml-2 px-1.5 py-0.5 text-[9px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded">
                          ADMIN
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-white/40">{u.role}</td>
                    <td className="px-4 py-3 text-white/70">{u.portfolios.length}</td>
                    <td className="px-4 py-3 text-white/70">
                      {u.portfolios.reduce((acc, p) => acc + p.holdings, 0)}
                    </td>
                    <td className="px-4 py-3 font-mono text-white/70">
                      ${u.portfolios.reduce((acc, p) => acc + p.loanBalance, 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-white/40">
                      {u.lastAudit ? new Date(u.lastAudit).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={`Global audit trail (latest ${audits.length})`}>
          <div className="bg-platter border border-line rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-white/40 font-mono border-b border-line">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Risk</th>
                  <th className="px-4 py-3 font-medium">LTV</th>
                  <th className="px-4 py-3 font-medium">Headroom</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {audits.map((a) => (
                  <tr key={a.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono text-white/50">{new Date(a.timestamp).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-1.5 py-0.5 text-[9px] font-mono rounded ${
                          a.riskState === "High Risk"
                            ? "text-rose-300 bg-rose-500/10 border border-rose-500/25"
                            : a.riskState === "Warning"
                            ? "text-amber-300 bg-amber-500/10 border border-amber-500/25"
                            : "text-emerald-300 bg-emerald-500/10 border border-emerald-500/25"
                        }`}
                      >
                        {a.riskState}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-white/70">{(a.currentLtv * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 font-mono text-white/70">${a.headroom.toLocaleString()}</td>
                    <td className="px-4 py-3 text-white/60">{a.recommendedAction}</td>
                    <td className="px-4 py-3 font-mono text-white/40">{a.provider}</td>
                  </tr>
                ))}
                {audits.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-white/30 text-center">No audit records yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
