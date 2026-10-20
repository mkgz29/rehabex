import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { EmailField, PasswordField } from '../components/auth/AuthFields';
import { AuthShell } from '../components/auth/AuthShell';
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
    <AuthShell
      title="Ingresar al panel"
      description="Acceso para administradores de Rehabex."
      footer={
        <Link to="/" className="font-semibold text-ink underline-offset-4 hover:underline">
          Volver a la tienda
        </Link>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <EmailField
          id="login-email"
          label="Email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailInvalid(false);
          }}
          autoComplete="email"
          maxLength={EMAIL_MAX_LENGTH}
          aria-invalid={emailInvalid}
          aria-describedby={error ? 'login-error' : undefined}
          required
        />

        <PasswordField
          id="login-password"
          label="Contraseña"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          aria-describedby={error ? 'login-error' : undefined}
          required
        />

        {error ? (
          <p id="login-error" role="alert" className="rounded-control bg-danger/[0.07] px-3.5 py-2.5 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="brand-button w-full !min-h-[3rem] rounded-full px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-70"
          disabled={submitting || loading}
        >
          {submitting ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </AuthShell>
  );
}
