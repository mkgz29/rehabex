import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { buyerLabel, orderReference, type AdminOrder } from '../orderPresentation';
import { AdminApiError, createSupportRequest, listRecentOrders, type SupportRequest } from '../../services/adminApi';
import { useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';
import { FormActions } from './FormActions';
import { FormField } from './FormField';

const MAX_CUSTOMER_NAME = 160;
const MAX_CUSTOMER_EMAIL = 254;
const MAX_CUSTOMER_PHONE = 40;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 4000;

type FormValues = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  subject: string;
  message: string;
  orderLabel: string;
};

const EMPTY_VALUES: FormValues = { customerName: '', customerEmail: '', customerPhone: '', subject: '', message: '', orderLabel: '' };

function messageForApiError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

/** "RHB-202610-000047 — Juan Perez", the same reference shown in Pedidos. The panel never otherwise shows a raw order id, so asking for one here would be unusable -- this label is what the admin can actually recognize, resolved back to the real id on submit. */
function orderOptionLabel(order: AdminOrder): string {
  return `${orderReference(order)} — ${buyerLabel(order)}`;
}

type NewSupportRequestFormProps = {
  onCreated: (supportRequest: SupportRequest) => void;
  onCancel: () => void;
};

export function NewSupportRequestForm({ onCreated, onCancel }: NewSupportRequestFormProps) {
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [ordersFailed, setOrdersFailed] = useState(false);
  const { setDirty, confirmDiscardIfDirty } = useUnsavedChanges();

  useEffect(() => {
    let mounted = true;
    listRecentOrders()
      .then((result) => {
        if (mounted) setOrders(result);
      })
      .catch(() => {
        // The order picker degrading to "type nothing" is acceptable; the rest
        // of the form (customer/subject/message) must stay usable regardless.
        if (mounted) setOrdersFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const orderIdByLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of orders) {
      if (typeof order.id === 'string') map.set(orderOptionLabel(order), order.id);
    }
    return map;
  }, [orders]);

  const isDirty = JSON.stringify(values) !== JSON.stringify(EMPTY_VALUES);
  const updateField = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => {
      const next = { ...current, [field]: value };
      setDirty('soporte-nueva-consulta', JSON.stringify(next) !== JSON.stringify(EMPTY_VALUES));
      return next;
    });
  };

  const handleCancel = () => {
    if (!confirmDiscardIfDirty()) return;
    setDirty('soporte-nueva-consulta', false);
    onCancel();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);

    const orderLabel = values.orderLabel.trim();
    let orderId: string | null = null;
    if (orderLabel) {
      const matched = orderIdByLabel.get(orderLabel);
      if (!matched) {
        setError('Seleccioná un pedido de la lista, o dejá el campo vacío.');
        setSaving(false);
        return;
      }
      orderId = matched;
    }

    try {
      const created = await createSupportRequest({
        customerName: values.customerName,
        customerEmail: values.customerEmail,
        customerPhone: values.customerPhone.trim() || null,
        subject: values.subject.trim() || null,
        message: values.message,
        orderId,
      });
      setDirty('soporte-nueva-consulta', false);
      onCreated(created);
    } catch (submitError) {
      setError(messageForApiError(submitError, 'No pudimos guardar la consulta. Revisa que todos los campos esten completos.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate aria-label="Nueva consulta">
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nombre *">
          <input
            type="text"
            required
            maxLength={MAX_CUSTOMER_NAME}
            value={values.customerName}
            onChange={(event) => updateField('customerName', event.target.value)}
            className="admin-input"
          />
        </FormField>
        <FormField label="Email *">
          <input
            type="email"
            required
            maxLength={MAX_CUSTOMER_EMAIL}
            value={values.customerEmail}
            onChange={(event) => updateField('customerEmail', event.target.value)}
            className="admin-input"
          />
        </FormField>
        <FormField label="Teléfono" hint="Opcional.">
          <input
            type="tel"
            maxLength={MAX_CUSTOMER_PHONE}
            value={values.customerPhone}
            onChange={(event) => updateField('customerPhone', event.target.value)}
            className="admin-input"
          />
        </FormField>
        <FormField label="Pedido relacionado" hint={ordersFailed ? 'No se pudieron cargar los pedidos recientes. Podes crear la consulta sin asociarla a un pedido.' : 'Opcional. Elegi uno de los pedidos recientes.'}>
          <input
            type="text"
            list="support-order-suggestions"
            value={values.orderLabel}
            onChange={(event) => updateField('orderLabel', event.target.value)}
            className="admin-input"
            autoComplete="off"
          />
          <datalist id="support-order-suggestions">
            {orders.map((order) => (
              <option key={order.id} value={orderOptionLabel(order)} />
            ))}
          </datalist>
        </FormField>
      </div>

      <FormField label="Asunto" hint="Opcional.">
        <input
          type="text"
          maxLength={MAX_SUBJECT}
          value={values.subject}
          onChange={(event) => updateField('subject', event.target.value)}
          className="admin-input"
        />
      </FormField>

      <FormField label="Mensaje *">
        <textarea
          required
          maxLength={MAX_MESSAGE}
          rows={4}
          value={values.message}
          onChange={(event) => updateField('message', event.target.value)}
          className="admin-input"
        />
      </FormField>

      {isDirty ? (
        <p role="status" className="text-xs font-medium text-amber-700">
          Tenes cambios sin guardar.
        </p>
      ) : null}

      <FormActions onCancel={handleCancel} saving={saving} submitLabel="Crear consulta" />
    </form>
  );
}
