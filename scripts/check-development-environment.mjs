import { loadEnv } from 'vite';

import {
  developmentEnvironmentProblems,
  formatDevelopmentEnvironmentFailure,
  readLinkedSupabaseProject,
} from './environment-safety.mjs';

const environment = loadEnv('development', process.cwd(), '');
const problems = developmentEnvironmentProblems(environment, {
  linkedSupabaseProject: readLinkedSupabaseProject(),
});

if (problems.length > 0) {
  console.error(formatDevelopmentEnvironmentFailure(problems));
  process.exitCode = 1;
} else {
  console.info('Development environment safety check passed.');
}
