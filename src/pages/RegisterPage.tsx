import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';

export function RegisterPage() {
  const { loading, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      await signUp(email.trim(), password);
      setEmail('');
      setPassword('');
      setSuccess('Cuenta creada correctamente. Ya podes iniciar sesion.');
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : 'No se pudo crear la cuenta.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-12 text-slate-900">
      <section className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">REHABEX</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Crear cuenta</h1>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium text-slate-800">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="admin-input mt-2"
              autoComplete="email"
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
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

          <button
            type="submit"
            className="brand-button inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
            disabled={submitting || loading}
          >
            {submitting ? 'Creando cuenta...' : 'Registrarse'}
          </button>
        </form>

        <Link to="/login" className="brand-link mt-5 inline-flex text-sm font-semibold">
          Ya tengo cuenta
        </Link>
      </section>
    </main>
  );
}
