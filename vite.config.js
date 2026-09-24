import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// This module intentionally stays plain JavaScript so the same checker can run
// before Vite starts and from Node's test runner.
import { developmentEnvironmentProblems, formatDevelopmentEnvironmentFailure, readLinkedSupabaseProject, } from './scripts/environment-safety.mjs';
export default defineConfig(function (_a) {
    var command = _a.command, mode = _a.mode;
    if (command === 'serve') {
        var problems = developmentEnvironmentProblems(loadEnv(mode, process.cwd(), ''), {
            linkedSupabaseProject: readLinkedSupabaseProject(),
        });
        if (problems.length > 0) {
            throw new Error(formatDevelopmentEnvironmentFailure(problems));
        }
    }
    return {
        plugins: [react()],
    };
});
