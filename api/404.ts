type ApiResponse = {
  status: (statusCode: number) => ApiResponse;
  json: (body: unknown) => void;
};

// Technical fallback for unknown /api/* paths. Static functions (exact file
// matches, e.g. api/checkout.ts) are resolved by Vercel's filesystem before
// this rewrite is considered. Dynamic functions (e.g.
// api/admin/[category]/[action].ts) are NOT: without the "(?!admin/)"
// exclusion on the rewrite in vercel.json, this route would shadow them and
// every request under their prefix would land here as a false 404,
// regardless of method or auth. Any new dynamic route added under api/ needs
// the same exclusion.
export default function handler(_request: unknown, response: ApiResponse) {
  return response.status(404).json({ error: 'API no encontrada.' });
}
