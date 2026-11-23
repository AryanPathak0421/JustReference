import mongoose from 'mongoose';
import { logger } from './logger';

mongoose.set('strictQuery', true);
// NoSQL-injection defence: every request body/query/param is parsed by a Zod schema into plain
// strings/numbers/booleans before it reaches a query, so client-supplied `{ $gt: … }` objects never
// get through. (Mongoose's global `sanitizeFilter` is not used: it also strips the operators our own
// code builds, e.g. `{ expiresAt: { $gt: now } }`.)

export async function connectDb(uri: string) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error('MongoDB must run as a replica set (transactions are required). Run `npm run db -w @jr/api` for local development.');
  }
  logger.info({ replicaSet: hello.setName }, 'MongoDB connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
