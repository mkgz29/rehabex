import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { EmailField, PasswordField } from '../components/auth/AuthFields';
import { AuthShell } from '../components/auth/AuthShell';

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
    <AuthShell
      title="Crear cuenta"
      description="Registrate con tu email para comenzar."
      footer={
        <Link to="/login" className="font-semibold text-ink underline-offset-4 hover:underline">
          Ya tengo cuenta
        </Link>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit} aria-busy={submitting}>
        <EmailField
          id="register-email"
          label="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />

        <PasswordField
          id="register-password"
          label="Contraseña"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />

        {error ? <p role="alert" className="rounded-control bg-danger/[0.07] px-3.5 py-2.5 text-sm font-medium text-danger">{error}</p> : null}
        {success ? <p role="status" className="rounded-control bg-success/[0.08] px-3.5 py-2.5 text-sm font-medium text-success">{success}</p> : null}

        <button
          type="submit"
          className="brand-button w-full !min-h-[3rem] rounded-full px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-70"
          disabled={submitting || loading}
        >
          {submitting ? 'Creando cuenta...' : 'Registrarse'}
        </button>
      </form>
    </AuthShell>
  );
}
