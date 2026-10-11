import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { PublicApiError, submitSupportRequest } from '../services/publicApi';
import { SUPPORT_TOPIC_LABELS, SUPPORT_TOPICS, type SupportTopic } from '../support/supportTopics';

const MAX_CUSTOMER_NAME = 160;
const MAX_CUSTOMER_EMAIL = 254;
const MAX_CUSTOMER_PHONE = 40;
const MAX_SUBJECT = 200;
const MAX_ORDER_REFERENCE = 60;
const MAX_MESSAGE = 4000;

type SupportIntakeStatus = 'idle' | 'submitting' | 'success' | 'error';

type FormValues = {
  topic: SupportTopic | '';
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  orderReference: string;
  subject: string;
  message: string;
};

const EMPTY_VALUES: FormValues = { topic: '', customerName: '', customerEmail: '', customerPhone: '', orderReference: '', subject: '', message: '' };

function messageForStatus(status: number): string {
  if (status === 429) return 'Enviaste varias consultas en poco tiempo. Intentá nuevamente en unos minutos.';
  return 'No pudimos enviar tu consulta. Intentá nuevamente en unos minutos.';
}

type SupportIntakeViewProps = {
  status: SupportIntakeStatus;
  errorMessage: string | null;
  values: FormValues;
  onFieldChange: <K extends keyof FormValues>(field: K, value: FormValues[K]) => void;
  honeypotValue: string;
  onHoneypotChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

/** Pure, prop-driven view -- every distinct state (idle, submitting, success, error) is reachable directly via props, the same split already used by SupportRequestDetail/AdminSupportPage, so each one is testable with renderToStaticMarkup without simulating a real submit. */
export function SupportIntakeView({ status, errorMessage, values, onFieldChange, honeypotValue, onHoneypotChange, onSubmit }: SupportIntakeViewProps) {
  if (status === 'success') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-stone-50 p-8 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Recibimos tu consulta.</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">Nuestro equipo te responderá a la brevedad.</p>
        <Link to="/" className="brand-button mt-6 inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold">
          Volver al inicio
        </Link>
      </div>
    );
  }

  const submitting = status === 'submitting';

  return (
    <form className="space-y-4" onSubmit={onSubmit} aria-label="Formulario de consulta">
      {status === 'error' && errorMessage ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      {/* Honeypot: real visitors never see or fill this. aria-hidden removes it
          from the accessibility tree entirely (never announced, never reachable
          by Tab), so it costs nothing for a real user. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
        <label htmlFor="support-company">Empresa</label>
        <input
          id="support-company"
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypotValue}
          onChange={(event) => onHoneypotChange(event.target.value)}
        />
      </div>

      <label className="block">
        <span className="text-sm font-medium text-slate-800">Motivo de consulta *</span>
        <select
          required
          value={values.topic}
          onChange={(event) => onFieldChange('topic', event.target.value as SupportTopic)}
          className="admin-input mt-2"
          aria-label="Motivo de consulta"
        >
          <option value="" disabled>
            Elegí un motivo
          </option>
          {SUPPORT_TOPICS.map((topic) => (
            <option key={topic} value={topic}>
              {SUPPORT_TOPIC_LABELS[topic]}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-800">Nombre *</span>
          <input
            type="text"
            required
            maxLength={MAX_CUSTOMER_NAME}
            value={values.customerName}
            onChange={(event) => onFieldChange('customerName', event.target.value)}
            className="admin-input mt-2"
            autoComplete="name"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">Email *</span>
          <input
            type="email"
            required
            maxLength={MAX_CUSTOMER_EMAIL}
            value={values.customerEmail}
            onChange={(event) => onFieldChange('customerEmail', event.target.value)}
            className="admin-input mt-2"
            autoComplete="email"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">Teléfono</span>
          <input
            type="tel"
            maxLength={MAX_CUSTOMER_PHONE}
            value={values.customerPhone}
            onChange={(event) => onFieldChange('customerPhone', event.target.value)}
            className="admin-input mt-2"
            autoComplete="tel"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">Número de pedido</span>
          <input
            type="text"
            maxLength={MAX_ORDER_REFERENCE}
            value={values.orderReference}
            onChange={(event) => onFieldChange('orderReference', event.target.value)}
            className="admin-input mt-2"
            autoComplete="off"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-slate-800">Asunto</span>
        <input
          type="text"
          maxLength={MAX_SUBJECT}
          value={values.subject}
          onChange={(event) => onFieldChange('subject', event.target.value)}
          className="admin-input mt-2"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-800">Mensaje *</span>
        <textarea
          required
          maxLength={MAX_MESSAGE}
          rows={5}
          value={values.message}
          onChange={(event) => onFieldChange('message', event.target.value)}
          className="admin-input mt-2"
        />
      </label>

      <button
        type="submit"
        className="brand-button inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
        disabled={submitting}
      >
        {submitting ? 'Enviando...' : 'Enviar consulta'}
      </button>
    </form>
  );
}

export function SupportIntakePage() {
  const [status, setStatus] = useState<SupportIntakeStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [honeypotValue, setHoneypotValue] = useState('');

  const updateField = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === 'submitting') return;
    if (!values.topic) return;

    setStatus('submitting');
    setErrorMessage(null);

    try {
      await submitSupportRequest({
        customerName: values.customerName,
        customerEmail: values.customerEmail,
        customerPhone: values.customerPhone.trim() || undefined,
        topic: values.topic,
        subject: values.subject.trim() || undefined,
        orderReference: values.orderReference.trim() || undefined,
        message: values.message,
        company: honeypotValue,
      });
      setStatus('success');
    } catch (error) {
      const statusCode = error instanceof PublicApiError ? error.status : 0;
      setErrorMessage(messageForStatus(statusCode));
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <section className="mx-auto w-full max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-500">Consultas Rehabex</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">¿Necesitás ayuda?</h1>
          <p className="mt-4 text-sm leading-6 text-slate-600 sm:text-base">
            Contanos qué necesitás y te respondemos a la brevedad.
          </p>

          <div className="mt-10">
            <SupportIntakeView
              status={status}
              errorMessage={errorMessage}
              values={values}
              onFieldChange={updateField}
              honeypotValue={honeypotValue}
              onHoneypotChange={setHoneypotValue}
              onSubmit={handleSubmit}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
