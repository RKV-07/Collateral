import React from "react";
import { Link, NavLink, Outlet, useNavigate, Navigate } from "react-router-dom";
import { ShieldCheck, LogOut, LayoutDashboard, LogIn, FlaskConical } from "lucide-react";
import { useAuth } from "../useAuth";

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-3 group">
      <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center font-bold text-black shadow-lg shadow-white/5 transition-transform group-hover:scale-105">
        C
      </div>
      <div className="leading-tight">
        <span className="font-medium text-white tracking-tight">Collateral</span>
        <span className="block text-[10px] text-white/40 font-mono">The watchman for stock-backed loans</span>
      </div>
    </Link>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-lg text-sm font-medium transition ${
    isActive ? "text-white bg-white/10" : "text-white/60 hover:text-white hover:bg-white/5"
  }`;

export default function PublicLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await fetch("/logout", { method: "POST" });
    navigate("/");
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-surface text-[#E0E0E0] font-sans selection:bg-white/20 selection:text-white flex flex-col">
      <header className="bg-platter/90 border-b border-line px-6 py-4 sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <Brand />
          <nav className="hidden md:flex items-center gap-1">
                <NavLink to="/demo" className={navLinkClass} onClick={(e) => { e.preventDefault(); window.location.href = "/demo"; }}>Demo</NavLink>
            <NavLink to="/solutions" className={navLinkClass}>Solutions</NavLink>
            <NavLink to="/pricing" className={navLinkClass}>Pricing</NavLink>
            <NavLink to="/whats-new" className={navLinkClass}>What&apos;s New</NavLink>
          </nav>
          <div className="flex items-center gap-3">
            {loading ? (
              <span className="text-xs text-white/40 font-mono animate-pulse">Loading…</span>
            ) : user ? (
              <>
                <Link
                  to="/dashboard"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-line hover:border-white/30 text-white/80 hover:text-white rounded-lg text-xs font-medium transition cursor-pointer"
                >
                  <LayoutDashboard size={13} />
                  Dashboard
                </Link>
                {user.role === "ADMIN" && (
                  <Link
                    to="/admin"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-line hover:border-white/30 text-white/80 hover:text-white rounded-lg text-xs font-medium transition cursor-pointer"
                  >
                    <ShieldCheck size={13} />
                    Admin
                  </Link>
                )}
                <span className="hidden lg:block text-xs text-white/40 font-mono max-w-[160px] truncate">{user.email}</span>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-white/50 hover:text-rose-300 rounded-lg text-xs font-medium transition cursor-pointer"
                  title="Sign out"
                >
                  <LogOut size={13} />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <a
                  href="/demo"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 hover:border-amber-400 text-amber-200 rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  <FlaskConical size={13} />
                  Try Demo
                </a>
                <Link
                  to="/login"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-line hover:border-white/30 text-white/80 hover:text-white rounded-lg text-xs font-medium transition cursor-pointer"
                >
                  <LogIn size={13} />
                  Sign in
                </Link>
                <a
                  href="/auth/google"
                  className="flex items-center gap-2 px-4 py-1.5 bg-white text-black rounded-lg text-xs font-semibold hover:bg-white/90 transition cursor-pointer"
                >
                  <ShieldCheck size={14} />
                  Sign in with Google
                </a>
              </div>
            )}
          </div>
        </div>
        {/* Mobile nav */}
        <nav className="md:hidden mt-3 flex items-center gap-4 border-t border-white/5 pt-3">
          <NavLink to="/demo" className="text-sm text-amber-200 hover:text-white" onClick={(e) => { e.preventDefault(); window.location.href = "/demo"; }}>Demo</NavLink>
          <NavLink to="/solutions" className="text-sm text-white/70 hover:text-white">Solutions</NavLink>
          <NavLink to="/pricing" className="text-sm text-white/70 hover:text-white">Pricing</NavLink>
          <NavLink to="/whats-new" className="text-sm text-white/70 hover:text-white">What&apos;s New</NavLink>
        </nav>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-platter/50 py-10 text-center text-xs text-white/30">
        <div className="max-w-6xl mx-auto px-8 flex flex-col items-center gap-3">
          <span className="font-mono">© 2026 Collateral — Portfolio Liquidity &amp; Tax Optimizer Agent</span>
          <p className="max-w-2xl leading-relaxed text-[11px] text-white/50">
            <strong className="text-white/60">Disclaimer:</strong> Collateral is a monitoring and planning tool. It is not a
            licensed financial or tax advisor, and its outputs are not individualized investment or tax advice. Nothing executes
            without your explicit approval.
          </p>
        </div>
      </footer>
    </div>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-white/40 font-mono text-xs animate-pulse flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-white/40 animate-ping" />
          Checking session…
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-white/40 font-mono text-xs animate-pulse flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-white/40 animate-ping" />
          Checking session…
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== "ADMIN") {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export function NavigateIfAuthed({ to }: { to: string }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  React.useEffect(() => {
    if (!loading && user) navigate(to, { replace: true });
  }, [user, loading, to, navigate]);
  return null;
}