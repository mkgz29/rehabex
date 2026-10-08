import type { SupportRequestStatus } from '../../services/adminApi';

export const SUPPORT_STATUS_LABELS: Record<SupportRequestStatus, string> = {
  open: 'Abierta',
  answered: 'Respondida',
  resolved: 'Resuelta',
};

export const SUPPORT_STATUS_TONE: Record<SupportRequestStatus, 'warning' | 'info' | 'success'> = {
  open: 'warning',
  answered: 'info',
  resolved: 'success',
};

/** Every state a ticket can move to from its current one. Deliberately not symmetric: a resolved ticket only reopens, it does not jump straight back to "answered" (that would skip a real step -- reopening means someone has to look at it again from the start). */
const SUPPORT_STATUS_TRANSITIONS: Record<SupportRequestStatus, SupportRequestStatus[]> = {
  open: ['answered', 'resolved'],
  answered: ['open', 'resolved'],
  resolved: ['open'],
};

export function allowedNextSupportStatuses(current: SupportRequestStatus): SupportRequestStatus[] {
  return SUPPORT_STATUS_TRANSITIONS[current] ?? [];
}

const STATUS_ACTION_LABELS: Record<SupportRequestStatus, string> = {
  open: 'Reabrir',
  answered: 'Marcar respondida',
  resolved: 'Marcar resuelta',
};

export function supportStatusActionLabel(target: SupportRequestStatus): string {
  return STATUS_ACTION_LABELS[target];
}

export function supportRequestPreview(message: string, maxLength = 90): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export type SupportStatusFilter = 'all' | SupportRequestStatus;

export const SUPPORT_STATUS_FILTERS: Array<{ value: SupportStatusFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Abiertas' },
  { value: 'answered', label: 'Respondidas' },
  { value: 'resolved', label: 'Resueltas' },
];
