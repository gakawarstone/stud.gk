import test from 'node:test';
import assert from 'node:assert/strict';
import { fileIcon } from './file-icon.ts';
test('repository icons recognize languages and build/config filenames', () => {
  for (const [name, expected] of Object.entries({
    'Main.kt': 'kotlin', 'script.kts': 'kotlin', 'BUILD.GRADLE.KTS': 'gradle', 'gradlew.bat': 'gradle',
    'gradle.properties': 'gradle', 'flake.lock': 'nixos', 'flake.nix': 'nixos', '.gitignore': 'git',
    'App.tsx': 'react', 'index.ts': 'typescript', 'Main.java': 'java', 'README.md': 'markdown',
    'Dockerfile': 'docker', 'test.py': 'python', 'unknown.xyz': null,
  })) assert.equal(fileIcon(name), expected, name);
});
