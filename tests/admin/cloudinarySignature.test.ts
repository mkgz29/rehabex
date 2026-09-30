import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  ALLOWED_UPLOAD_FORMATS,
  buildCloudinaryUploadParams,
  canonicalizeCloudinaryParams,
  cloudinaryEnv,
  signCloudinaryParams,
  signUploadParams,
  type CloudinaryEnv,
} from '../../server/admin/cloudinaryClient';
import { buildCloudinaryUploadFormData, validateFileForUpload } from '../../src/services/mediaApi';

const TEST_ENV: CloudinaryEnv = {
  cloudName: 'fixture-cloud',
  apiKey: 'fixture-key',
  apiSecret: 'fixture-secret',
};

const FIXED_INPUT = {
  publicId: '11111111-2222-4333-8444-555555555555',
  folder: 'rehabex/products',
  timestamp: 1_700_000_000,
};

test('uses the independent Cloudinary SHA-1 vector and not HMAC-SHA1', () => {
  // Published Cloudinary vector: SHA-1("timestamp=1315060510" + "abcd").
  const signature = signCloudinaryParams({ timestamp: '1315060510' }, 'abcd');
  assert.equal(signature, 'a21ad0f63beb4de2e5575204b79ab90bffb02c10');
  assert.notEqual(signature, createHmac('sha1', 'abcd').update('timestamp=1315060510').digest('hex'));
});

test('canonicalizes by parameter name and excludes unsigned names and empty values', () => {
  const canonical = canonicalizeCloudinaryParams({
    timestamp: '1700000000',
    signature: 'not-signed',
    public_id: FIXED_INPUT.publicId,
    overwrite: 'false',
    file: 'not-signed',
    folder: FIXED_INPUT.folder,
    cloud_name: 'not-signed',
    api_key: 'not-signed',
    allowed_formats: ALLOWED_UPLOAD_FORMATS,
    empty: '',
    absent: undefined,
    nil: null,
  });

  assert.equal(
    canonical,
    `allowed_formats=jpg,jpeg,png,webp&folder=rehabex/products&overwrite=false&public_id=${FIXED_INPUT.publicId}&timestamp=1700000000`,
  );
});

test('the upload signature contains exactly the five production contract fields', () => {
  const uploadParams = buildCloudinaryUploadParams(FIXED_INPUT);
  assert.deepEqual(Object.keys(uploadParams), [
    'allowed_formats',
    'folder',
    'overwrite',
    'public_id',
    'timestamp',
  ]);
  assert.equal(uploadParams.allowed_formats, 'jpg,jpeg,png,webp');
  assert.equal(uploadParams.folder, FIXED_INPUT.folder);
  assert.equal(uploadParams.overwrite, 'false');
  assert.equal(uploadParams.public_id, FIXED_INPUT.publicId);
  assert.equal('max_file_size' in uploadParams, false);
});

test('FormData sends exactly the same upload parameter object that was signed', () => {
  const signed = signUploadParams(TEST_ENV, FIXED_INPUT);
  // Independently calculated from the five-field canonical string with .NET SHA1.
  assert.equal(signed.signature, 'dccbcee156eed8469c4b3caf25b41d4079356f43');
  const file = new File(['fixture'], 'fixture.jpg', { type: 'image/jpeg' });
  const formData = buildCloudinaryUploadFormData(file, {
    mediaAssetId: 'fixture-asset',
    uploadUrl: signed.uploadUrl,
    cloudName: signed.cloudName,
    apiKey: signed.apiKey,
    uploadParams: signed.uploadParams,
    signature: signed.signature,
    requestId: 'fixture-request',
  });

  const sentUploadParams = Object.fromEntries(
    [...formData.entries()]
      .filter(([name]) => !['file', 'api_key', 'signature'].includes(name))
      .map(([name, value]) => [name, String(value)]),
  );

  assert.deepEqual(sentUploadParams, signed.uploadParams);
  assert.equal(formData.get('allowed_formats'), 'jpg,jpeg,png,webp');
  assert.equal(formData.get('overwrite'), 'false');
  assert.equal(formData.has('max_file_size'), false);
});

test('the own pre-upload validation still rejects files over 8 MB', async () => {
  const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'oversized.jpg', { type: 'image/jpeg' });
  const result = await validateFileForUpload(oversized);
  assert.deepEqual(result, { ok: false, message: 'La imagen supera el tamano maximo de 8 MB.' });
});

test('environment values are trimmed without adding quotes or CRLF', () => {
  const names = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  try {
    process.env.CLOUDINARY_CLOUD_NAME = ' fixture-cloud\r\n';
    process.env.CLOUDINARY_API_KEY = ' fixture-key\r\n';
    process.env.CLOUDINARY_API_SECRET = ' fixture-secret\r\n';
    assert.deepEqual(cloudinaryEnv(), TEST_ENV);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
