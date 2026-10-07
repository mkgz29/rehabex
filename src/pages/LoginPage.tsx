import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { EMAIL_MAX_LENGTH, isValidEmailFormat, normalizeEmail } from '../auth/emailNormalization';

type LocationState = {
  from?: {
    pathname?: string;
  };
};

export function LoginPage() {
  const { loading, signIn, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailInvalid, setEmailInvalid] = useState(false);

  const from = (location.state as LocationState | null)?.from?.pathname ?? '/admin';

  if (!loading && user) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmailFormat(normalizedEmail)) {
      setEmailInvalid(true);
      setError('Ingresa un email valido.');
      return;
    }
    setEmailInvalid(false);

    setSubmitting(true);
    try {
      // Email is normalized above; the password is forwarded exactly as
      // typed -- a generic "credenciales invalidas" error never reveals
      // which of the two was wrong, so neither field is marked invalid here.
      await signIn(normalizedEmail, password);
      navigate(from, { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'No se pudo iniciar sesion.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-12 text-slate-900">
      <section className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">REHABEX</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Ingresar al panel</h1>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
          <label className="block">
            <span className="text-sm font-medium text-slate-800">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailInvalid(false);
              }}
              className="admin-input mt-2"
              autoComplete="email"
              maxLength={EMAIL_MAX_LENGTH}
              aria-invalid={emailInvalid}
              aria-describedby={error ? 'login-error' : undefined}
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-800">Contrasena</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="admin-input mt-2"
              autoComplete="current-password"
              aria-describedby={error ? 'login-error' : undefined}
              required
            />
          </label>

          {error ? (
            <p id="login-error" role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="brand-button inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
            disabled={submitting || loading}
          >
            {submitting ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  );
}
