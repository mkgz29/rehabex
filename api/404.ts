type ApiResponse = {
  status: (statusCode: number) => ApiResponse;
  json: (body: unknown) => void;
};

// Technical fallback for unknown /api/* paths. Existing functions are resolved
// by Vercel's filesystem before the rewrite in vercel.json reaches this route.
export default function handler(_request: unknown, response: ApiResponse) {
  return response.status(404).json({ error: 'API no encontrada.' });
}
