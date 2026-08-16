export interface UserDTO {
  id: string;
  googleId: string;
  email: string;
  name: string | null;
  role: string;
}

export async function loginWithPassword(email: string, password: string): Promise<UserDTO> {
  const data = await api<{ user: UserDTO }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return data.user;
}

export interface LotDTO {
  id: string;
  quantity: number;
  costBasis: number;
  acquiredAt: string;
  acquiredDate: string;
}

export interface HoldingDTO {
  id: string;
  symbol: string;
  lots: LotDTO[];
}

export interface PortfolioDTO {
  id: string;
  cash: number;
  loanBalance: number;
  maintenanceLtvLimit: number;
  updatedAt: string;
  holdings: HoldingDTO[];
}

export interface HoldingInput {
  symbol: string;
  quantity: number;
  costBasis: number;
  acquiredAt: string;
}

export interface PriceInfo {
  price: number;
  source: string;
  dayChange?: number;
  dayChangePct?: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = String(data.error);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export async function getCurrentUser(): Promise<UserDTO | null> {
  try {
    const data = await api<{ user: UserDTO }>("/api/me");
    return data.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}