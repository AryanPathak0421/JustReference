#!/usr/bin/env node
/**
 * Starts a single-node MongoDB replica set for local development on port 27117,
 * storing data in apps/api/.data/db. Replica sets are required for transactions.
 *
 * It does not touch any MongoDB service already installed on the machine.
 * Set MONGOD_PATH if mongod is not on PATH.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, '..', '.data', 'db');
const port = Number(process.env.DEV_DB_PORT ?? 27117);
mkdirSync(dbPath, { recursive: true });

const mongod = spawn(process.env.MONGOD_PATH ?? 'mongod', ['--replSet', 'rs0', '--port', String(port), '--bind_ip', '127.0.0.1', '--dbpath', dbPath, '--quiet'], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
mongod.on('error', (e) => {
  console.error(`Could not start mongod: ${e.message}. Install MongoDB 7+ or set MONGOD_PATH.`);
  process.exit(1);
});
mongod.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => mongod.kill());

// Initiate the replica set once mongod accepts connections.
const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 1000 }).asPromise();
    const admin = conn.db.admin();
    try {
      await admin.command({ replSetGetStatus: 1 });
    } catch {
      await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
      console.log('Initialised replica set rs0');
    }
    await conn.close();
    console.log(`MongoDB replica set ready: mongodb://127.0.0.1:${port}/justreference?replicaSet=rs0`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
