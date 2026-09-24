// Shared authorization boundary for every /api/admin/* endpoint.
//
// Never trusts the frontend's isAdmin flag or any role claim sent by the
// client: the JWT is validated against Supabase Auth, then the role is looked
// up fresh in profiles. The service role key is only ever used for that
// lookup. The RPC call itself runs on a client scoped to the caller's own
// access token, so auth.uid() resolves correctly inside the SECURITY DEFINER
// admin RPCs without ever using service_role for the mutation.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

import {
  applyAdminCors,
  isJsonContentType,
  logEvent,
  readJsonBody,
  requestHeader,
  type ApiRequest,
  type ApiResponse,
} from '../commerce/commerce.js';

export const MAX_ADMIN_BODY_BYTES = 16 * 1024;

export type AdminAuthUser = { id: string; role?: string; app_metadata?: Record<string, unknown> };
export type AdminAuthClient = {
  auth: { getUser: (token: string) => Promise<{ data: { user: AdminAuthUser | null }; error: unknown }> };
  from: (table: string) => any;
};
export type AdminRpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string | null; message?: string } | null }> };

export type RequireAdminDependencies = {
  authClient: () => AdminAuthClient | null;
  userScopedClient: (accessToken: string) => AdminRpcClient | null;
};

function defaultAuthClient(): AdminAuthClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as AdminAuthClient;
}

function defaultUserScopedClient(accessToken: string): AdminRpcClient | null {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  }) as unknown as AdminRpcClient;
}

export const defaultRequireAdminDependencies: RequireAdminDependencies = {
  authClient: defaultAuthClient,
  userScopedClient: defaultUserScopedClient,
};

export type AdminContext = {
  kind: 'ok';
  userId: string;
  requestId: string;
  body: unknown;
  rpc: AdminRpcClient;
};

export type AdminAuthFailure = { kind: 'error'; status: number; error: string };

function bearerToken(value: string | null) {
  if (!value || !value.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length).trim();
  return token || null;
}

/**
 * Runs the full ADMIN-01B request boundary: method, origin, Content-Type,
 * body size, bearer JWT validation, and a fresh admin role check. Returns the
 * parsed body, a per-request id for the audit trail, and an RPC-capable
 * client scoped to the caller's own token. Never returns the token or the
 * Supabase session.
 */
export async function requireAdmin(
  request: ApiRequest,
  response: ApiResponse,
  deps: RequireAdminDependencies = defaultRequireAdminDependencies,
): Promise<AdminContext | AdminAuthFailure> {
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST, OPTIONS');
    return { kind: 'error', status: 405, error: 'Metodo no permitido.' };
  }
  if (!applyAdminCors(request, response)) return { kind: 'error', status: 403, error: 'No autorizado.' };
  if (!isJsonContentType(request)) return { kind: 'error', status: 415, error: 'Solicitud invalida.' };

  const bodyResult = await readJsonBody(request, MAX_ADMIN_BODY_BYTES);
  if (bodyResult.ok === false) {
    return { kind: 'error', status: bodyResult.reason === 'invalid' ? 400 : 413, error: 'Solicitud invalida.' };
  }

  const authorization = requestHeader(request, 'authorization');
  if (!authorization.value || authorization.ambiguous) return { kind: 'error', status: 401, error: 'No autorizado.' };
  const token = bearerToken(authorization.value);
  if (!token) return { kind: 'error', status: 401, error: 'No autorizado.' };

  const authClient = deps.authClient();
  if (!authClient) {
    logEvent('admin_boundary_not_configured');
    return { kind: 'error', status: 503, error: 'No disponible.' };
  }

  const { data, error } = await authClient.auth.getUser(token);
  const user = data?.user;
  if (error || !user || user.role === 'service_role' || user.app_metadata?.role === 'service_role') {
    return { kind: 'error', status: 401, error: 'No autorizado.' };
  }

  const { data: profile, error: profileError } = await authClient.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profileError) {
    logEvent('admin_boundary_profile_lookup_failed');
    return { kind: 'error', status: 500, error: 'No disponible.' };
  }
  if (!profile || profile.role !== 'admin') return { kind: 'error', status: 403, error: 'No autorizado.' };

  const rpc = deps.userScopedClient(token);
  if (!rpc) {
    logEvent('admin_boundary_not_configured');
    return { kind: 'error', status: 503, error: 'No disponible.' };
  }

  return { kind: 'ok', userId: user.id, requestId: randomUUID(), body: bodyResult.value, rpc };
}

export function isAdminContext(result: AdminContext | AdminAuthFailure): result is AdminContext {
  return result.kind === 'ok';
}
