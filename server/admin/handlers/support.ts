// Handler logic for the admin Support routes (ADMIN-03A). Lives outside
// api/ so it counts as zero Vercel Serverless Functions on its own;
// api/admin/[category]/[action].ts is the single function that dispatches
// to these by path. v1 is admin-only: there is no public submission
// endpoint here, so every one of these routes requires the same requireAdmin
// boundary as products/settings/media.
import { mapAdminRpcError } from '../adminErrors.js';
import { defaultRequireAdminDependencies, requireAdmin, type RequireAdminDependencies } from '../requireAdmin.js';
import { mapAdminSupportRequestRow, type AdminSupportRequestRow } from '../serialize.js';
import {
  isValid,
  parseCreateSupportRequestPayload,
  parseGetSupportRequestPayload,
  parseListSupportRequestsPayload,
  parseUpdateSupportRequestNotesPayload,
  parseUpdateSupportRequestStatusPayload,
} from '../validators.js';
import { applyAdminCors, logEvent, type ApiRequest, type ApiResponse } from '../../commerce/commerce.js';

export function createAdminListSupportRequestsHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseListSupportRequestsPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const { data, error } = await auth.rpc.rpc('admin_list_support_requests', { p_status: payload.value.status });

    if (error) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_support_list_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    const rows = (data as AdminSupportRequestRow[] | null) ?? [];
    return response.status(200).json({ supportRequests: rows.map(mapAdminSupportRequestRow), requestId: auth.requestId });
  };
}

export function createAdminGetSupportRequestHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseGetSupportRequestPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const { data, error } = await auth.rpc.rpc('admin_get_support_request', { p_support_request_id: payload.value.id });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_support_get_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    return response.status(200).json({ supportRequest: mapAdminSupportRequestRow(data as AdminSupportRequestRow), requestId: auth.requestId });
  };
}

export function createAdminCreateSupportRequestHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseCreateSupportRequestPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const { data, error } = await auth.rpc.rpc('admin_create_support_request', {
      p_customer_name: payload.value.customerName,
      p_customer_email: payload.value.customerEmail,
      p_customer_phone: payload.value.customerPhone,
      p_subject: payload.value.subject,
      p_message: payload.value.message,
      p_order_id: payload.value.orderId,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_support_create_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent('admin_support_created');
    return response.status(200).json({ supportRequest: mapAdminSupportRequestRow(data as AdminSupportRequestRow), requestId: auth.requestId });
  };
}

export function createAdminUpdateSupportRequestStatusHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseUpdateSupportRequestStatusPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const { data, error } = await auth.rpc.rpc('admin_update_support_request_status', {
      p_support_request_id: payload.value.id,
      p_status: payload.value.status,
      p_expected_updated_at: payload.value.expectedUpdatedAt,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_support_status_update_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent('admin_support_status_updated');
    return response.status(200).json({ supportRequest: mapAdminSupportRequestRow(data as AdminSupportRequestRow), requestId: auth.requestId });
  };
}

export function createAdminUpdateSupportRequestNotesHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseUpdateSupportRequestNotesPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const { data, error } = await auth.rpc.rpc('admin_update_support_request_notes', {
      p_support_request_id: payload.value.id,
      p_internal_notes: payload.value.internalNotes,
      p_expected_updated_at: payload.value.expectedUpdatedAt,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_support_notes_update_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent('admin_support_notes_updated');
    return response.status(200).json({ supportRequest: mapAdminSupportRequestRow(data as AdminSupportRequestRow), requestId: auth.requestId });
  };
}
