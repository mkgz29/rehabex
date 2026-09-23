import assert from 'node:assert/strict';
import test from 'node:test';

import {
  developmentEnvironmentProblems,
  formatDevelopmentEnvironmentFailure,
} from '../../scripts/environment-safety.mjs';

test('rejects development when its safety classification or Supabase variables are absent', () => {
  const problems = developmentEnvironmentProblems({});
  assert.equal(problems.length, 2);
});

test('allows localhost and 127.0.0.1 Supabase only when explicitly classified as local', () => {
  for (const host of ['localhost', '127.0.0.1']) {
    assert.deepEqual(developmentEnvironmentProblems({
      REHABEX_DATA_ENV: 'local',
      VITE_SUPABASE_URL: `http://${host}:56321`,
      VITE_SUPABASE_ANON_KEY: 'placeholder',
    }), []);
  }
});

test('allows an explicitly classified staging backend', () => {
  assert.deepEqual(developmentEnvironmentProblems({
    REHABEX_DATA_ENV: 'staging',
    VITE_SUPABASE_URL: 'https://staging-ref.supabase.co',
    SUPABASE_URL: 'https://staging-ref.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'placeholder',
  }, {
    linkedSupabaseProject: { name: 'rehabex-staging', ref: 'staging-ref' },
  }), []);
});

test('rejects unclassified, production and mislabeled local backends', () => {
  assert.equal(developmentEnvironmentProblems({
    VITE_SUPABASE_URL: 'https://project.example.invalid',
    VITE_SUPABASE_ANON_KEY: 'placeholder',
  }).length, 1);
  assert.equal(developmentEnvironmentProblems({
    REHABEX_DATA_ENV: 'production',
    VITE_SUPABASE_URL: 'https://project.example.invalid',
    VITE_SUPABASE_ANON_KEY: 'placeholder',
  }).length, 1);
  assert.equal(developmentEnvironmentProblems({
    REHABEX_DATA_ENV: 'local',
    VITE_SUPABASE_URL: 'https://project.example.invalid',
    VITE_SUPABASE_ANON_KEY: 'placeholder',
  }).length, 1);
});

test('rejects an invalid Supabase URL', () => {
  assert.equal(developmentEnvironmentProblems({
    REHABEX_DATA_ENV: 'local',
    VITE_SUPABASE_URL: 'not-a-url',
    VITE_SUPABASE_ANON_KEY: 'placeholder',
  }).length, 1);
});

test('rejects remote staging when the linked project is absent, production-named or does not match', () => {
  const environment = {
    REHABEX_DATA_ENV: 'staging',
    VITE_SUPABASE_URL: 'https://staging-ref.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'placeholder',
  };

  assert.equal(developmentEnvironmentProblems(environment).length, 1);
  assert.equal(developmentEnvironmentProblems(environment, {
    linkedSupabaseProject: { name: 'rehabex-cms', ref: 'staging-ref' },
  }).length, 1);
  assert.equal(developmentEnvironmentProblems(environment, {
    linkedSupabaseProject: { name: 'rehabex-staging', ref: 'different-ref' },
  }).length, 1);
});

test('rejects browser Cloudinary configuration for local development and production payments everywhere', () => {
  const problems = developmentEnvironmentProblems({
    REHABEX_DATA_ENV: 'local',
    VITE_SUPABASE_URL: 'http://127.0.0.1:56321',
    VITE_SUPABASE_ANON_KEY: 'placeholder',
    VITE_CLOUDINARY_CLOUD_NAME: 'placeholder',
    VITE_CLOUDINARY_UPLOAD_PRESET: 'placeholder',
    MERCADOPAGO_ENV: 'production',
  });
  assert.equal(problems.length, 2);
});

test('failure output never includes rejected endpoints, project refs or keys', () => {
  const endpoint = 'https://sensitive-project-ref.supabase.co';
  const key = 'sensitive-public-key-value';
  const output = formatDevelopmentEnvironmentFailure(developmentEnvironmentProblems({
    REHABEX_DATA_ENV: 'local',
    VITE_SUPABASE_URL: endpoint,
    VITE_SUPABASE_ANON_KEY: key,
  }));

  assert.equal(output.includes(endpoint), false);
  assert.equal(output.includes('sensitive-project-ref'), false);
  assert.equal(output.includes(key), false);
});
