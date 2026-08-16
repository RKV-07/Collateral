import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./useAuth";
import PublicLayout, { RequireAuth, RequireAdmin } from "./components/PublicLayout";
import Home from "./pages/Home";
import Solutions from "./pages/Solutions";
import Pricing from "./pages/Pricing";
import WhatsNew from "./pages/WhatsNew";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Demo from "./pages/Demo";
import Stocks from "./pages/Stocks";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/solutions" element={<Solutions />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/whats-new" element={<WhatsNew />} />
        </Route>
        <Route path="/login" element={<Login />} />
        <Route path="/demo" element={<Demo />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/stocks"
          element={
            <RequireAuth>
              <Stocks />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <Admin />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}