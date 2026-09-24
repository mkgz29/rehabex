// Single Vercel Serverless Function for every /api/admin/{products,settings,
// media}/* route. The Hobby plan caps a project at 12 functions; before this
// file, each ADMIN-01B/01C endpoint was its own file (7 functions), which
// pushed the project over the limit and broke Preview deployments. Routing,
// auth (requireAdmin), CORS, validation, responses, status codes and
// auditing are unchanged -- only *where* the handler code lives moved, to
// server/admin/handlers/*, which is outside api/ and so never becomes a
// function of its own.
//
// This is two nested single dynamic segments ([category]/[action].ts), not a
// catch-all ([...path].ts): on this project's zero-config (non-Next.js) Vite
// build, Vercel compiles a catch-all segment to a single-path-segment regex
// (`[^/]+`, matching /api/admin/foo but never /api/admin/products/create),
// so every one of these two-segment routes would 404 through Vercel's own
// generic fallback even with routing otherwise correct. Nested single
// segments compile to one capture group per level and match reliably;
// verified against the real compiled output (`vercel build`), not just unit
// tests of this file in isolation.
//
// api/admin/reconcile-payment.ts is a separate, more specific static route
// and is matched by Vercel before this dynamic one; it is untouched.
import { createAdminCreateProductHandler, createAdminSetProductActiveHandler, createAdminUpdateProductHandler } from '../../../server/admin/handlers/products.js';
import { createAdminAboutSettingsHandler, createAdminHeroSettingsHandler } from '../../../server/admin/handlers/settings.js';
import { createAdminMediaFinalizeHandler, createAdminMediaSignHandler } from '../../../server/admin/handlers/media.js';
import type { ApiRequest, ApiResponse } from '../../../server/commerce/commerce.js';

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

type DynamicSegmentRequest = ApiRequest & { query?: Record<string, string | string[] | undefined> };

function segment(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default async function handler(request: DynamicSegmentRequest, response: ApiResponse) {
  const category = segment(request.query?.category);
  const action = segment(request.query?.action);
  const route = routes[`${category}/${action}`];
  if (!route) return response.status(404).json({ error: 'API no encontrada.' });
  return route(request, response);
}
