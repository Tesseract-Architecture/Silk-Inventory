import { useQuery, useQueryClient } from '@tanstack/react-query';

export class ApiError extends Error {
  constructor(message: string, public status: number, public data: any) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.location.href = '/login';
  }
  if (!res.ok) throw new ApiError(data?.error || `Error ${res.status}`, res.status, data);
  return data as T;
}

// ---------- tipos ----------

export type Role = 'admin' | 'usuario' | 'lectura';
export interface User { id: number; email: string; name: string; role: Role; phone: string | null }
export interface UserOption { id: number; name: string; email: string; has_phone: number }

export type ItemStatus = 'disponible' | 'prestado' | 'reservado' | 'en_uso' | 'en_reparacion' | 'roto' | 'baja';

export interface Item {
  id: number;
  code: string;
  description: string;
  category_id: number | null;
  category: string | null;
  brand: string | null;
  part_number: string | null;
  serial_number: string | null;
  location_id: number | null;
  location: string | null;
  status: ItemStatus;
  kind: 'unidad' | 'consumible';
  quantity: number;
  unit: string | null;
  min_stock: number | null;
  box_mismatch: number;
  notes: string | null;
  updated_at: string;
  /** En uso por alguien de Silk (no es préstamo). */
  assigned_to: number | null;
  assigned_name: string | null;
  loan_id: number | null;
  loan_contact: string | null;
  loan_company: string | null;
  loaned_at: string | null;
  loan_due: string | null;
  loaned_qty: number | null;
}

export interface Location {
  id: number;
  name: string;
  parent_id: number | null;
  kind: string;
  notes: string | null;
  path: string;
  item_count: number;
}

export interface ModelStock { id: number; model: string; min_qty: number; notes: string | null; available: number }

export interface Category { id: number; name: string; item_count: number }

export interface Contact {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active_loans: number;
  total_loans: number;
}

export interface Loan {
  id: number;
  item_id: number;
  contact_id: number;
  quantity: number;
  loaned_at: string;
  due_date: string | null;
  returned_at: string | null;
  notes: string | null;
  reminder_every_days: number | null;
  reminders_paused: number;
  last_reminder_at: string | null;
  reminder_count: number;
  contact_name: string;
  contact_company: string | null;
  contact_phone: string | null;
  item_code: string;
  item_description: string;
  serial_number: string | null;
  item_kind: string;
  loaned_by_name: string | null;
  returned_by_name: string | null;
  /** De la empresa: a quién le llegan los recordatorios para reclamarlo. */
  responsible_id: number | null;
  responsible_name: string | null;
  responsible_phone: string | null;
  /** WhatsApp efectivo del recordatorio (responsable o número/grupo interno). */
  remind_to: string | null;
  days: number;
  overdue: boolean;
  remind_today: boolean;
}

export interface Movement {
  id: number;
  action: string;
  detail: string | null;
  created_at: string;
  item_id: number | null;
  user_id?: number | null;
  code?: string | null;
  description?: string | null;
  serial_number?: string | null;
  user: string | null;
  reverted_at?: string | null;
  reverted_by_name?: string | null;
  revertible?: boolean;
}

// ---------- hooks ----------

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User | null; devLogin: boolean; entraConfigured: boolean }>('/api/auth/me'),
    staleTime: 60_000,
  });

export const useItems = (all = false) =>
  useQuery({ queryKey: ['items', all], queryFn: () => api<Item[]>(`/api/items${all ? '?all=1' : ''}`) });
export const useLocations = () => useQuery({ queryKey: ['locations'], queryFn: () => api<Location[]>('/api/locations') });
export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/api/categories') });
export const useContacts = () => useQuery({ queryKey: ['contacts'], queryFn: () => api<Contact[]>('/api/contacts') });
export const useUsers = () => useQuery({ queryKey: ['users-list'], queryFn: () => api<UserOption[]>('/api/users') });

export const useLoans = (status: 'active' | 'returned' | 'all' = 'active') =>
  useQuery({ queryKey: ['loans', status], queryFn: () => api<Loan[]>(`/api/loans?status=${status}`) });

/** Invalida todo lo que depende del inventario después de un cambio. */
export function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['items', 'item', 'loans', 'dashboard', 'locations', 'categories', 'contacts', 'activity', 'model-stock']) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
}

export const canWrite = (u?: User | null) => !!u && u.role !== 'lectura';
export const isAdmin = (u?: User | null) => u?.role === 'admin';
