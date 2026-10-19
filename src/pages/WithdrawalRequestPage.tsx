import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { PublicApiError, submitWithdrawalRequest } from '../services/publicApi';

const EMPTY_VALUES = { customerName: '', customerEmail: '', customerPhone: '', orderReference: '', message: '' };
type FormValues = typeof EMPTY_VALUES;
type Status = 'idle' | 'submitting' | 'success' | 'error';

type WithdrawalRequestViewProps = {
  status: Status;
  requestCode: string | null;
  errorMessage: string | null;
  values: FormValues;
  honeypotValue: string;
  onFieldChange: (field: keyof FormValues, value: string) => void;
  onHoneypotChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function WithdrawalRequestView({
  status,
  requestCode,
  errorMessage,
  values,
  honeypotValue,
  onFieldChange,
  onHoneypotChange,
  onSubmit,
}: WithdrawalRequestViewProps) {
  if (status === 'success' && requestCode) {
    return (
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-7 sm:p-9" role="status">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-800">Solicitud registrada</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Guardá tu código de trámite</h2>
        <p className="mt-5 break-all rounded-2xl bg-white px-4 py-4 text-center font-mono text-xl font-bold text-primary" data-testid="withdrawal-code">
          {requestCode}
        </p>
        <p className="mt-4 text-sm leading-6 text-slate-700">
          El código fue emitido al registrar tu solicitud. Nuestro equipo la revisará y se comunicará al email informado.
        </p>
        <Link to="/" className="brand-button mt-6 inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold">
          Volver al inicio
        </Link>
      </div>
    );
  }

  const submitting = status === 'submitting';
  return (
    <form className="space-y-5" onSubmit={onSubmit} aria-label="Formulario de arrepentimiento">
      {status === 'error' && errorMessage ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</p>
      ) : null}

      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
        <label htmlFor="withdrawal-form-guard">Dejar vacío</label>
        <input
          id="withdrawal-form-guard"
          name="form_guard"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypotValue}
          onChange={(event) => onHoneypotChange(event.target.value)}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-800">Nombre y apellido *</span>
          <input required maxLength={160} autoComplete="name" className="admin-input mt-2" value={values.customerName} onChange={(event) => onFieldChange('customerName', event.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">Email usado en la compra *</span>
          <input type="email" required maxLength={254} autoComplete="email" className="admin-input mt-2" value={values.customerEmail} onChange={(event) => onFieldChange('customerEmail', event.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">Número de pedido *</span>
          <input required maxLength={60} autoComplete="off" className="admin-input mt-2" value={values.orderReference} onChange={(event) => onFieldChange('orderReference', event.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">Teléfono (opcional)</span>
          <input type="tel" maxLength={40} autoComplete="tel" className="admin-input mt-2" value={values.customerPhone} onChange={(event) => onFieldChange('customerPhone', event.target.value)} />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-slate-800">Comentario (opcional)</span>
        <textarea rows={4} maxLength={2000} className="admin-input mt-2" value={values.message} onChange={(event) => onFieldChange('message', event.target.value)} />
      </label>

      <p className="rounded-2xl bg-stone-100 px-4 py-3 text-xs leading-5 text-slate-600">
        No incluyas números de tarjeta, datos bancarios, contraseñas ni códigos de seguridad.
      </p>

      <button type="submit" disabled={submitting} className="brand-button inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto">
        {submitting ? 'Registrando...' : 'Enviar solicitud de arrepentimiento'}
      </button>
    </form>
  );
}

export function WithdrawalRequestPage() {
  const [status, setStatus] = useState<Status>('idle');
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [honeypotValue, setHoneypotValue] = useState('');
  const [requestCode, setRequestCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateField = (field: keyof FormValues, value: string) => setValues((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setErrorMessage(null);
    try {
      const result = await submitWithdrawalRequest({
        customerName: values.customerName,
        customerEmail: values.customerEmail,
        customerPhone: values.customerPhone.trim() || undefined,
        orderReference: values.orderReference,
        message: values.message.trim() || undefined,
        formGuard: honeypotValue,
      });
      setRequestCode(result.requestCode);
      setStatus('success');
    } catch (error) {
      const statusCode = error instanceof PublicApiError ? error.status : 0;
      setErrorMessage(statusCode === 429
        ? 'Se enviaron varias solicitudes desde esta conexión. Intentá nuevamente en unos minutos.'
        : 'No pudimos registrar la solicitud. Intentá nuevamente en unos minutos.');
      setStatus('error');
    }
  };

  return (
    <main className="min-h-screen bg-white px-4 py-14 text-slate-900 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
      <section className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Revocación de compra</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">BOTÓN DE ARREPENTIMIENTO</h1>
        <p className="mt-5 text-sm leading-6 text-slate-600 sm:text-base">
          Podés solicitar la revocación de una compra sin iniciar sesión. Este trámite registra tu pedido para revisión; no cancela la orden ni genera un reintegro automático.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Pedimos únicamente los datos necesarios para identificar razonablemente la compra y contactarte.
        </p>
        <div className="mt-10">
          <WithdrawalRequestView
            status={status}
            requestCode={requestCode}
            errorMessage={errorMessage}
            values={values}
            honeypotValue={honeypotValue}
            onFieldChange={updateField}
            onHoneypotChange={setHoneypotValue}
            onSubmit={handleSubmit}
          />
        </div>
      </section>
    </main>
  );
}
