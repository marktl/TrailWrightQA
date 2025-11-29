#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const steps = [
  {
    name: 'Root workspace',
    cwd: rootDir,
    args: ['install'],
    skip: Boolean(process.env.TRAILWRIGHT_SKIP_ROOT_INSTALL)
  },
  {
    name: 'Server',
    cwd: path.join(rootDir, 'server'),
    args: ['install']
  },
  {
    name: 'Client',
    cwd: path.join(rootDir, 'client'),
    args: ['install']
  }
];

function runStep(step) {
  return new Promise((resolve, reject) => {
    if (step.skip) {
      console.log(`⚪ Skipping ${step.name} install (env override)`);
      resolve();
      return;
    }

    console.log(`\n📦 Installing dependencies for ${step.name}...`);
    const child = spawn(npmCmd, step.args, {
      cwd: step.cwd,
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${step.name} ready`);
        resolve();
      } else {
        reject(new Error(`${step.name} install failed with exit code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

(async () => {
  try {
    for (const step of steps) {
      await runStep(step);
    }
    console.log('\n🎉 TrailWright dependencies installed. Run `npm run dev` to start.');
  } catch (error) {
    console.error(`\n❌ Setup failed: ${error.message}`);
    process.exit(1);
  }
})();
