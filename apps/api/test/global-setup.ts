import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

/** Prefer the locally installed mongod (no download); fall back to mongodb-memory-server's binary. */
function systemMongod(): string | undefined {
  if (process.env.MONGOMS_SYSTEM_BINARY) return process.env.MONGOMS_SYSTEM_BINARY;
  try {
    const cmd = process.platform === 'win32' ? 'where mongod' : 'command -v mongod';
    const path = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0]?.trim();
    return path && existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

let replSet: MongoMemoryReplSet;

export async function setup(project: TestProject) {
  const systemBinary = systemMongod();
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: systemBinary ? { systemBinary } : undefined,
  });
  project.provide('mongoUri', replSet.getUri('jr_test'));
}

export async function teardown() {
  await replSet?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
