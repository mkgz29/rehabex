import type { SupportRequestSource, SupportRequestStatus } from '../../services/adminApi';

export { SUPPORT_TOPIC_LABELS, SUPPORT_TOPICS, type SupportTopic } from '../../support/supportTopics';

/** 'admin' for a staff-logged ticket, 'web' for one submitted through /soporte (ADMIN-03B). */
export const SUPPORT_SOURCE_LABELS: Record<SupportRequestSource, string> = {
  admin: 'Panel',
  web: 'Web',
};

export const SUPPORT_STATUS_LABELS: Record<SupportRequestStatus, string> = {
  open: 'Abierta',
  answered: 'Respondida',
  resolved: 'Resuelta',
  archived: 'Archivada',
};

export const SUPPORT_STATUS_TONE: Record<SupportRequestStatus, 'warning' | 'info' | 'success' | 'neutral'> = {
  open: 'warning',
  answered: 'info',
  resolved: 'success',
  archived: 'neutral',
};

/**
 * Every state a ticket can move to from its current one. Deliberately not
 * symmetric: a resolved ticket only reopens, it does not jump straight back
 * to "answered" (that would skip a real step -- reopening means someone has
 * to look at it again from the start). Any active state (open/answered/
 * resolved) can be archived -- it never deletes anything, it only removes
 * the ticket from the default "Todas" view (FASE 7D.2). An archived ticket
 * can only be reopened, straight back to "open", never directly to
 * answered/resolved -- same "start over" rule as any other reopen.
 */
const SUPPORT_STATUS_TRANSITIONS: Record<SupportRequestStatus, SupportRequestStatus[]> = {
  open: ['answered', 'resolved', 'archived'],
  answered: ['open', 'resolved', 'archived'],
  resolved: ['open', 'archived'],
  archived: ['open'],
};

export function allowedNextSupportStatuses(current: SupportRequestStatus): SupportRequestStatus[] {
  return SUPPORT_STATUS_TRANSITIONS[current] ?? [];
}

const STATUS_ACTION_LABELS: Record<SupportRequestStatus, string> = {
  open: 'Reabrir',
  answered: 'Marcar respondida',
  resolved: 'Marcar resuelta',
  archived: 'Archivar',
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

// 'Todas' deliberately excludes archived tickets (FASE 7D.2) -- that's the
// whole point of archiving: it lets the admin keep historical tickets
// without them cluttering the default view. Only the explicit 'archived'
// filter shows them. This exclusion is applied client-side in
// AdminSupportPage (see loadList), not by this list itself.
export const SUPPORT_STATUS_FILTERS: Array<{ value: SupportStatusFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Abiertas' },
  { value: 'answered', label: 'Respondidas' },
  { value: 'resolved', label: 'Resueltas' },
  { value: 'archived', label: 'Archivadas' },
];
