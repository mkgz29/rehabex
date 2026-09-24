// Single Vercel Serverless Function for every /api/admin/{products,settings,
// media}/* route. The Hobby plan caps a project at 12 functions; before this
// file, each ADMIN-01B/01C endpoint was its own file (7 functions), which
// pushed the project over the limit and broke Preview deployments. Routing,
// auth (requireAdmin), CORS, validation, responses, status codes and
// auditing are unchanged -- only *where* the handler code lives moved, to
// server/admin/handlers/*, which is outside api/ and so never becomes a
// function of its own.
//
// api/admin/reconcile-payment.ts is a separate, more specific static route
// and is matched by Vercel before this catch-all; it is untouched.
import { createAdminCreateProductHandler, createAdminSetProductActiveHandler, createAdminUpdateProductHandler } from '../../server/admin/handlers/products.js';
import { createAdminAboutSettingsHandler, createAdminHeroSettingsHandler } from '../../server/admin/handlers/settings.js';
import { createAdminMediaFinalizeHandler, createAdminMediaSignHandler } from '../../server/admin/handlers/media.js';
import type { ApiRequest, ApiResponse } from '../../server/commerce/commerce.js';

export const config = { api: { bodyParser: false } };

type AdminRouteHandler = (request: ApiRequest, response: ApiResponse) => Promise<void>;

const routes: Record<string, AdminRouteHandler> = {
  'products/create': createAdminCreateProductHandler(),
  'products/update': createAdminUpdateProductHandler(),
  'products/set-active': createAdminSetProductActiveHandler(),
  'settings/hero': createAdminHeroSettingsHandler(),
  'settings/about': createAdminAboutSettingsHandler(),
  'media/sign': createAdminMediaSignHandler(),
  'media/finalize': createAdminMediaFinalizeHandler(),
};

type CatchAllRequest = ApiRequest & { query?: Record<string, string | string[] | undefined> };

export default async function handler(request: CatchAllRequest, response: ApiResponse) {
  const rawPath = request.query?.path;
  const segments = Array.isArray(rawPath) ? rawPath : typeof rawPath === 'string' ? [rawPath] : [];
  const route = routes[segments.join('/')];
  if (!route) return response.status(404).json({ error: 'API no encontrada.' });
  return route(request, response);
}
