import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValid,
  mimeTypeForFormat,
  parseMediaFinalizePayload,
  parseMediaSignPayload,
  validateResourceMetadata,
} from '../../server/admin/mediaValidators';

test('parseMediaSignPayload accepts each known intent and rejects anything else', () => {
  assert.equal(isValid(parseMediaSignPayload({ intent: 'product' })), true);
  assert.equal(isValid(parseMediaSignPayload({ intent: 'hero' })), true);
  assert.equal(isValid(parseMediaSignPayload({ intent: 'about' })), true);
  assert.equal(isValid(parseMediaSignPayload({ intent: 'gallery' })), false);
  assert.equal(isValid(parseMediaSignPayload({ intent: '' })), false);
  assert.equal(isValid(parseMediaSignPayload({})), false);
  assert.equal(isValid(parseMediaSignPayload(null)), false);
});

test('parseMediaSignPayload rejects unknown fields, including a client-chosen folder', () => {
  assert.equal(isValid(parseMediaSignPayload({ intent: 'product', folder: 'rehabex/anything' })), false);
  assert.equal(isValid(parseMediaSignPayload({ intent: 'product', publicId: 'attacker-chosen' })), false);
  assert.equal(isValid(parseMediaSignPayload({ intent: 'product', resourceType: 'raw' })), false);
  assert.equal(isValid(parseMediaSignPayload({ intent: 'product', overwrite: true })), false);
  assert.equal(isValid(parseMediaSignPayload({ intent: 'product', tags: ['x'] })), false);
});

const VALID_FINALIZE = {
  publicId: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7',
  version: 1700000000,
  signature: 'a'.repeat(40),
};

test('parseMediaFinalizePayload accepts a well-formed payload', () => {
  assert.equal(isValid(parseMediaFinalizePayload(VALID_FINALIZE)), true);
});

test('parseMediaFinalizePayload rejects unknown fields, including client-supplied format/size/dimensions', () => {
  for (const key of ['format', 'resourceType', 'bytes', 'width', 'height', 'secureUrl', 'mimeType']) {
    const result = parseMediaFinalizePayload({ ...VALID_FINALIZE, [key]: 'x' });
    assert.equal(isValid(result), false, `expected ${key} to be rejected`);
  }
});

test('parseMediaFinalizePayload rejects a malformed public ID (folder/path injection attempts)', () => {
  for (const publicId of ['../../etc/passwd', 'rehabex/products/x', 'a b c', '', 'x'.repeat(200)]) {
    assert.equal(isValid(parseMediaFinalizePayload({ ...VALID_FINALIZE, publicId })), false, `expected ${publicId} to be rejected`);
  }
});

test('parseMediaFinalizePayload rejects a non-positive-integer version', () => {
  for (const version of [0, -1, 1.5, 'abc', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(isValid(parseMediaFinalizePayload({ ...VALID_FINALIZE, version })), false, `expected version ${String(version)} to be rejected`);
  }
});

test('parseMediaFinalizePayload rejects a malformed or altered-looking signature', () => {
  for (const signature of ['', 'not-hex', 'ABCDEF'.repeat(10), 'a'.repeat(10), 'a'.repeat(200)]) {
    assert.equal(isValid(parseMediaFinalizePayload({ ...VALID_FINALIZE, signature })), false, `expected ${signature} to be rejected`);
  }
});

const VALID_RESOURCE = { format: 'jpg', resource_type: 'image', bytes: 250000, width: 1200, height: 900, secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg' };

test('validateResourceMetadata accepts a well-formed Cloudinary Admin API resource', () => {
  const result = validateResourceMetadata(VALID_RESOURCE);
  assert.equal(isValid(result), true);
});

test('validateResourceMetadata rejects disallowed formats (svg, gif, pdf) and unknown formats', () => {
  for (const format of ['svg', 'gif', 'pdf', 'mp4', 'bmp', '']) {
    assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, format })), false, `expected ${format} to be rejected`);
  }
});

test('validateResourceMetadata rejects a non-image resource_type', () => {
  assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, resource_type: 'video' })), false);
  assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, resource_type: 'raw' })), false);
});

test('validateResourceMetadata rejects bytes over 8MB or non-positive', () => {
  assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, bytes: 9_000_000 })), false);
  assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, bytes: 0 })), false);
  assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, bytes: -1 })), false);
});

test('validateResourceMetadata rejects dimensions outside 400..6000px', () => {
  assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, width: 399 })), false);
  assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, height: 399 })), false);
  assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, width: 6001 })), false);
  assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, height: 6001 })), false);
});

test('validateResourceMetadata rejects a missing secure_url', () => {
  assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, secure_url: undefined })), false);
  assert.equal(isValid(validateResourceMetadata({ ...VALID_RESOURCE, secure_url: 123 })), false);
});

test('mimeTypeForFormat maps only the allowed formats', () => {
  assert.equal(mimeTypeForFormat('jpg'), 'image/jpeg');
  assert.equal(mimeTypeForFormat('JPEG'), 'image/jpeg');
  assert.equal(mimeTypeForFormat('png'), 'image/png');
  assert.equal(mimeTypeForFormat('webp'), 'image/webp');
  assert.equal(mimeTypeForFormat('svg'), null);
  assert.equal(mimeTypeForFormat('gif'), null);
});
