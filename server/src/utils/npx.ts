import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export interface NpxInvocation {
  command: string;
  argsPrefix: string[];
  env?: NodeJS.ProcessEnv;
}

let cachedInvocation: NpxInvocation | null = null;

const filePath = fileURLToPath(import.meta.url);
const dirPath = path.dirname(filePath);

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function prependPath(base: string, existing: string | undefined): string {
  return existing ? `${base}${path.delimiter}${existing}` : base;
}

async function collectNodePaths(): Promise<string[]> {
  const candidates = new Set<string>([
    path.resolve(dirPath, '../../node_modules'),
    path.resolve(dirPath, '../../../node_modules'),
    path.resolve(process.cwd(), 'node_modules'),
    path.resolve(process.cwd(), '../node_modules'),
    path.resolve(process.cwd(), '../../node_modules')
  ]);

  const paths: string[] = [];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      paths.push(candidate);
    }
  }

  return paths;
}

async function createBaseEnv(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const nodePaths = await collectNodePaths();
  if (nodePaths.length > 0) {
    const combined = nodePaths.join(path.delimiter);
    env.NODE_PATH = env.NODE_PATH ? `${combined}${path.delimiter}${env.NODE_PATH}` : combined;
  }
  return env;
}

async function resolveViaNodeExec(baseEnv: NodeJS.ProcessEnv): Promise<NpxInvocation | null> {
  const nodeExec = process.execPath;
  if (!nodeExec) {
    return null;
  }

  const npxCli = path.join(
    path.dirname(nodeExec),
    'node_modules',
    'npm',
    'bin',
    'npx-cli.js'
  );

  if (!(await fileExists(npxCli))) {
    return null;
  }

  return {
    command: nodeExec,
    argsPrefix: [npxCli],
    env: baseEnv
  };
}

async function resolveViaBinary(baseEnv: NodeJS.ProcessEnv): Promise<NpxInvocation | null> {
  const binaryName = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const candidateDirs = new Set<string>();

  const npmNodeExecPath = process.env.npm_node_execpath;
  if (npmNodeExecPath) {
    candidateDirs.add(path.dirname(npmNodeExecPath));
  }

  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    candidateDirs.add(path.dirname(npmExecPath));
    candidateDirs.add(path.dirname(path.dirname(npmExecPath)));
  }

  candidateDirs.add(path.dirname(process.execPath));

  for (const dir of candidateDirs) {
    const candidate = path.join(dir, binaryName);
    if (await fileExists(candidate)) {
      if (process.platform === 'win32') {
        const env = { ...baseEnv, PATH: prependPath(dir, baseEnv.PATH) };
        return {
          command: binaryName,
          argsPrefix: [],
          env
        };
      }

      return {
        command: candidate,
        argsPrefix: [],
        env: baseEnv
      };
    }
  }

  const pathEntries = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    const candidate = path.join(entry, binaryName);
    if (await fileExists(candidate)) {
      if (process.platform === 'win32') {
        const env = { ...baseEnv, PATH: prependPath(entry, baseEnv.PATH) };
        return {
          command: binaryName,
          argsPrefix: [],
          env
        };
      }

      return {
        command: candidate,
        argsPrefix: [],
        env: baseEnv
      };
    }
  }

  return null;
}

export async function resolveNpxInvocation(): Promise<NpxInvocation> {
  if (cachedInvocation) {
    return cachedInvocation;
  }

  const baseEnv = await createBaseEnv();

  const nodeExecInvocation = await resolveViaNodeExec(baseEnv);
  if (nodeExecInvocation) {
    cachedInvocation = nodeExecInvocation;
    return cachedInvocation;
  }

  const binaryInvocation = await resolveViaBinary(baseEnv);
  if (binaryInvocation) {
    cachedInvocation = binaryInvocation;
    return cachedInvocation;
  }

  throw new Error(
    'Unable to locate the "npx" executable. Install Node.js (which bundles npm/npx) and ensure it is on PATH.'
  );
}
