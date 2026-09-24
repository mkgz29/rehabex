import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SAFE_DEVELOPMENT_DATA_ENVIRONMENTS = new Set(['local', 'staging']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function developmentEnvironmentProblems(environment, options = {}) {
  const problems = [];
  const dataEnvironment = environment.REHABEX_DATA_ENV?.trim().toLowerCase() ?? '';
  const supabaseUrls = [environment.VITE_SUPABASE_URL, environment.SUPABASE_URL]
    .map((value) => value?.trim())
    .filter(Boolean);
  const hasSupabaseConfig = supabaseUrls.length > 0
    || Boolean(environment.VITE_SUPABASE_ANON_KEY?.trim())
    || Boolean(environment.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const hasExternalServiceConfig = hasSupabaseConfig
    || Boolean(environment.VITE_CLOUDINARY_CLOUD_NAME?.trim())
    || Boolean(environment.VITE_CLOUDINARY_UPLOAD_PRESET?.trim())
    || Boolean(environment.MERCADOPAGO_ACCESS_TOKEN?.trim())
    || Boolean(environment.MERCADOPAGO_WEBHOOK_SECRET?.trim())
    || Boolean(environment.MERCADOPAGO_ENV?.trim());

  if (!SAFE_DEVELOPMENT_DATA_ENVIRONMENTS.has(dataEnvironment)) {
    problems.push('REHABEX_DATA_ENV must explicitly be local or staging when development uses external services.');
  }

  if (!environment.VITE_SUPABASE_URL?.trim() || !environment.VITE_SUPABASE_ANON_KEY?.trim()) {
    problems.push('Development requires an explicit Supabase URL and public anonymous key.');
  }

  if (!hasExternalServiceConfig || problems.length > 0) {
    return problems;
  }

  if (dataEnvironment === 'local') {
    for (const value of supabaseUrls) {
      if (!isLoopbackUrl(value)) {
        problems.push('A local data environment may only use loopback Supabase URLs.');
        break;
      }
    }

    if (environment.VITE_CLOUDINARY_CLOUD_NAME?.trim() || environment.VITE_CLOUDINARY_UPLOAD_PRESET?.trim()) {
      problems.push('Browser Cloudinary configuration is not allowed in the local data environment.');
    }
  }

  if (dataEnvironment === 'staging' && supabaseUrls.some((value) => !isLoopbackUrl(value))) {
    const linkedProject = options.linkedSupabaseProject;
    if (!isVerifiedStagingProject(linkedProject, supabaseUrls)) {
      problems.push('Remote staging requires this worktree to be linked to the same Supabase project, named explicitly as staging.');
    }
  }

  if (environment.MERCADOPAGO_ENV?.trim().toLowerCase() === 'production') {
    problems.push('Development may not use the production Mercado Pago environment.');
  }

  return problems;
}

export function readLinkedSupabaseProject(workspace = process.cwd()) {
  try {
    const raw = readFileSync(join(workspace, 'supabase', '.temp', 'linked-project.json'), 'utf8');
    const value = JSON.parse(raw);
    return typeof value?.name === 'string' && typeof value?.ref === 'string'
      ? { name: value.name, ref: value.ref }
      : null;
  } catch {
    return null;
  }
}

export function formatDevelopmentEnvironmentFailure(problems) {
  return [
    'Development environment safety check failed:',
    ...problems.map((problem) => `- ${problem}`),
    'No credential, endpoint or project identifier was printed. Use local services or a dedicated staging environment.',
  ].join('\n');
}

function isVerifiedStagingProject(project, urls) {
  if (!project || !/staging/i.test(project.name) || !project.ref) {
    return false;
  }

  return urls.every((value) => {
    try {
      return new URL(value).hostname.toLowerCase() === `${project.ref.toLowerCase()}.supabase.co`;
    } catch {
      return false;
    }
  });
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
