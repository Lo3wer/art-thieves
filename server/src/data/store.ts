import { isPersistent } from './db';
import { store as memoryStore } from './memory';

export * from './types';

let store: typeof memoryStore;
if (isPersistent()) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  store = require('./store-sqlite').store;
} else {
  store = memoryStore;
}

export { store };
