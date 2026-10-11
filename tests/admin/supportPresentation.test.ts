import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUPPORT_STATUS_FILTERS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_TONE,
  allowedNextSupportStatuses,
  supportRequestPreview,
  supportStatusActionLabel,
} from '../../src/admin/support/supportPresentation';

test('allowedNextSupportStatuses matches exactly the approved transition map (FASE 7D.2: archived added)', () => {
  assert.deepEqual(allowedNextSupportStatuses('open').sort(), ['answered', 'archived', 'resolved']);
  assert.deepEqual(allowedNextSupportStatuses('answered').sort(), ['archived', 'open', 'resolved']);
  assert.deepEqual(allowedNextSupportStatuses('resolved').sort(), ['archived', 'open']);
  assert.deepEqual(allowedNextSupportStatuses('archived'), ['open']);
});

test('allowedNextSupportStatuses never offers the current status as its own next state', () => {
  for (const status of ['open', 'answered', 'resolved', 'archived'] as const) {
    assert.ok(!allowedNextSupportStatuses(status).includes(status), `${status} should not transition to itself`);
  }
});

test('every active status can be archived; an archived ticket can only be reopened, never directly to answered/resolved', () => {
  for (const status of ['open', 'answered', 'resolved'] as const) {
    assert.ok(allowedNextSupportStatuses(status).includes('archived'), `${status} should offer "Archivar"`);
  }
  assert.deepEqual(allowedNextSupportStatuses('archived'), ['open']);
});

test('every status has a label and a tone', () => {
  for (const status of ['open', 'answered', 'resolved', 'archived'] as const) {
    assert.ok(SUPPORT_STATUS_LABELS[status]);
    assert.ok(SUPPORT_STATUS_TONE[status]);
  }
});

test('status labels use the feminine form agreeing with "consulta"', () => {
  assert.equal(SUPPORT_STATUS_LABELS.open, 'Abierta');
  assert.equal(SUPPORT_STATUS_LABELS.answered, 'Respondida');
  assert.equal(SUPPORT_STATUS_LABELS.resolved, 'Resuelta');
  assert.equal(SUPPORT_STATUS_LABELS.archived, 'Archivada');
});

test('supportStatusActionLabel describes the target state, not the source', () => {
  assert.equal(supportStatusActionLabel('open'), 'Reabrir');
  assert.equal(supportStatusActionLabel('answered'), 'Marcar respondida');
  assert.equal(supportStatusActionLabel('resolved'), 'Marcar resuelta');
  assert.equal(supportStatusActionLabel('archived'), 'Archivar');
});

test('supportRequestPreview leaves a short message untouched', () => {
  assert.equal(supportRequestPreview('Hola, necesito ayuda.'), 'Hola, necesito ayuda.');
});

test('supportRequestPreview truncates a long message with an ellipsis, never exceeding the limit', () => {
  const long = 'x'.repeat(200);
  const preview = supportRequestPreview(long, 90);
  assert.ok(preview.length <= 90);
  assert.ok(preview.endsWith('…'));
});

test('supportRequestPreview collapses internal newlines/whitespace into single spaces', () => {
  assert.equal(supportRequestPreview('Hola\n\ncomo estas?   bien'), 'Hola como estas? bien');
});

test('SUPPORT_STATUS_FILTERS exposes exactly the five approved filters, in order, including Archivadas', () => {
  assert.deepEqual(
    SUPPORT_STATUS_FILTERS.map((filter) => filter.value),
    ['all', 'open', 'answered', 'resolved', 'archived'],
  );
  assert.deepEqual(
    SUPPORT_STATUS_FILTERS.map((filter) => filter.label),
    ['Todas', 'Abiertas', 'Respondidas', 'Resueltas', 'Archivadas'],
  );
});
