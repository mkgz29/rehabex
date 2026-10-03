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

test('allowedNextSupportStatuses matches exactly the approved transition map', () => {
  assert.deepEqual(allowedNextSupportStatuses('open').sort(), ['answered', 'resolved']);
  assert.deepEqual(allowedNextSupportStatuses('answered').sort(), ['open', 'resolved']);
  assert.deepEqual(allowedNextSupportStatuses('resolved'), ['open']);
});

test('allowedNextSupportStatuses never offers the current status as its own next state', () => {
  for (const status of ['open', 'answered', 'resolved'] as const) {
    assert.ok(!allowedNextSupportStatuses(status).includes(status), `${status} should not transition to itself`);
  }
});

test('every status has a label and a tone', () => {
  for (const status of ['open', 'answered', 'resolved'] as const) {
    assert.ok(SUPPORT_STATUS_LABELS[status]);
    assert.ok(SUPPORT_STATUS_TONE[status]);
  }
});

test('supportStatusActionLabel describes the target state, not the source', () => {
  assert.equal(supportStatusActionLabel('open'), 'Reabrir');
  assert.equal(supportStatusActionLabel('answered'), 'Marcar respondido');
  assert.equal(supportStatusActionLabel('resolved'), 'Marcar resuelto');
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

test('SUPPORT_STATUS_FILTERS exposes exactly the four approved filters, in order', () => {
  assert.deepEqual(
    SUPPORT_STATUS_FILTERS.map((filter) => filter.value),
    ['all', 'open', 'answered', 'resolved'],
  );
});
