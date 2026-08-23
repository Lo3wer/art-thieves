import { isPersistent } from './db';
import { store as memoryStore } from './memory';

export * from './types';

type SyncStore = typeof memoryStore;
export type Store = {
  [K in keyof SyncStore]: SyncStore[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};

function asyncify(source: SyncStore): Store {
  const entries = Object.entries(source).map(([name, operation]) => [
    name,
    async (...args: unknown[]) => Reflect.apply(operation, source, args),
  ] as const);
  return Object.fromEntries(entries) as Store;
}

let store: Store;
const driver = (process.env.DB_DRIVER ?? (isPersistent() ? 'sqlite' : 'memory')).toLowerCase();
if (driver === 'memory' || !isPersistent()) {
  store = asyncify(memoryStore);
} else if (driver === 'sqlite') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  store = asyncify(require('./store-sqlite').store);
} else if (driver === 'postgres') {
  if (!process.env.DATABASE_URL) throw new Error('DB_DRIVER=postgres requires DATABASE_URL');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  store = require('./store-postgres').store;
} else {
  throw new Error(`Unsupported DB_DRIVER: ${driver}. Expected memory, sqlite, or postgres`);
}

export { store };
