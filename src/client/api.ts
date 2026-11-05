export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      data?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      data?.error?.code,
    );
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: PublicUser | null; guestId?: string }>("/api/me"),
  config: () => request<AppConfig>("/api/config"),
  register: (body: { email: string; password: string; displayName?: string }) =>
    request<{ user: PublicUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    request<{ user: PublicUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  verifyEmail: (token: string) =>
    request<{ ok: boolean; message: string }>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  resendVerification: () =>
    request("/api/auth/resend-verification", { method: "POST" }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean; message: string }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request("/api/account/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  updateAccount: (displayName: string) =>
    request<{ user: PublicUser }>("/api/account", {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
    }),
  listTrips: () => request<{ trips: TripSummary[] }>("/api/trips"),
  createTrip: (prefs: Record<string, unknown> = {}) =>
    request<{ trip: Trip }>("/api/trips", {
      method: "POST",
      body: JSON.stringify(prefs),
    }),
  getTrip: (id: string) =>
    request<{ trip: Trip; messages: ChatMessage[] }>(`/api/trips/${id}`),
  updateTrip: (id: string, prefs: Record<string, unknown>) =>
    request<{ trip: Trip }>(`/api/trips/${id}`, {
      method: "PATCH",
      body: JSON.stringify(prefs),
    }),
  deleteTrip: (id: string) =>
    request(`/api/trips/${id}`, { method: "DELETE" }),
  chat: (id: string, message: string) =>
    request<{
      assistantMessage: ChatMessage;
      trip: Trip;
      itineraryUpdated: boolean;
    }>(`/api/trips/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  editActivity: (
    id: string,
    body: {
      action: "remove" | "reorder" | "replace";
      day: number;
      activityId?: string;
      activityIds?: string[];
      activity?: Record<string, unknown>;
    },
  ) =>
    request<{ itinerary: Itinerary }>(`/api/trips/${id}/itinerary/activities`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

export const adminApi = {
  login: (username: string, password: string) =>
    request<{ admin: AdminUser }>("/admin/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request("/admin/api/logout", { method: "POST" }),
  me: () => request<{ admin: AdminUser }>("/admin/api/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request("/admin/api/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  overview: (qs: string) => request<any>(`/admin/api/metrics/overview?${qs}`),
  timeseries: (qs: string) => request<any>(`/admin/api/metrics/timeseries?${qs}`),
  users: (qs: string) => request<any>(`/admin/api/users?${qs}`),
  user: (id: string) => request<any>(`/admin/api/users/${id}`),
  disableUser: (id: string) =>
    request(`/admin/api/users/${id}/disable`, { method: "POST" }),
  enableUser: (id: string) =>
    request(`/admin/api/users/${id}/enable`, { method: "POST" }),
  deleteUser: (id: string) =>
    request(`/admin/api/users/${id}?confirm=delete`, { method: "DELETE" }),
  trips: (qs: string) => request<any>(`/admin/api/trips?${qs}`),
  trip: (id: string) => request<any>(`/admin/api/trips/${id}`),
  admins: () => request<any>("/admin/api/admins"),
  createAdmin: (username: string, password: string) =>
    request("/admin/api/admins", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  resetAdminPassword: (id: string, newPassword: string) =>
    request(`/admin/api/admins/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    }),
  disableAdmin: (id: string) =>
    request(`/admin/api/admins/${id}/disable`, { method: "POST" }),
  enableAdmin: (id: string) =>
    request(`/admin/api/admins/${id}/enable`, { method: "POST" }),
  deleteAdmin: (id: string) =>
    request(`/admin/api/admins/${id}`, { method: "DELETE" }),
  usage: (qs: string) => request<any>(`/admin/api/usage?${qs}`),
  ops: () => request<any>("/admin/api/ops/errors"),
  audit: () => request<any>("/admin/api/audit"),
};

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  username: string;
  mustChangePassword: boolean;
}

export interface AppConfig {
  publicUrl: string;
  mapsEnabled: boolean;
  emailConfigured: boolean;
  llmProvider: string | null;
  llmModel: string | null;
  llmConfigured: boolean;
}

export interface TripSummary {
  id: string;
  title: string;
  destination: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  createdAt: string;
  updatedAt: string;
  ownerType: "user" | "guest";
  itineraryDayCount: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface Itinerary {
  version: 1;
  destination?: string;
  summary?: string;
  currency?: string;
  estimatedTotalCost?: number;
  costDisclaimer?: string;
  days: Array<{
    day: number;
    date?: string;
    title?: string;
    summary?: string;
    estimatedDailyCost?: number;
    activities: Array<{
      id: string;
      name: string;
      description?: string;
      category?: string;
      startTime?: string;
      endTime?: string;
      durationMinutes?: number;
      location?: {
        name?: string;
        address?: string;
        lat?: number;
        lng?: number;
      };
      estimatedCost?: number;
      costIsEstimate?: boolean;
      notes?: string;
      transportation?: string;
    }>;
  }>;
  tips?: string[];
}

export interface Trip {
  id: string;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  travelersAdults: number | null;
  travelersChildren: number | null;
  childrenAges: number[];
  budgetAmount: number | null;
  budgetCurrency: string;
  interests: string[];
  travelPace: string | null;
  specialRequirements: string | null;
  status: string;
  itinerary: Itinerary | null;
  createdAt: string;
  updatedAt: string;
  ownerType: "user" | "guest";
}
