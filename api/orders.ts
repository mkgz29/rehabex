import { createClient } from '@supabase/supabase-js';

type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (statusCode: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader?: (name: string, value: string) => void;
};

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'GET') {
    response.setHeader?.('Allow', 'GET');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[orders] Faltan variables backend requeridas.', {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseServiceRoleKey: Boolean(supabaseServiceRoleKey),
    });
    return response.status(500).json({ error: 'Orders API no esta configurada.' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const token = getBearerToken(request.headers?.authorization);
    if (!token) {
      return response.status(401).json({ error: 'No autorizado.' });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      console.error('[orders] Token invalido consultando ordenes.', userError);
      return response.status(401).json({ error: 'No autorizado.' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single();

    if (profileError || profile?.role !== 'admin') {
      console.error('[orders] Usuario sin permisos para consultar ordenes.', {
        userId: userData.user.id,
        error: profileError,
      });
      return response.status(403).json({ error: 'No autorizado.' });
    }

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[orders] No se pudieron obtener las ordenes.', error);
      return response.status(500).json({ error: 'No se pudieron obtener las ordenes.' });
    }

    return response.status(200).json({ orders: data ?? [] });
  } catch (error) {
    console.error('[orders] Error inesperado obteniendo ordenes.', error);
    return response.status(500).json({ error: 'No se pudieron obtener las ordenes.' });
  }
}

function getBearerToken(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();
  return token || null;
}
