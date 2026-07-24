type QueuedAction = {
  id: string;
  type: string;
  payload: unknown;
  timestamp: string;
};

let queue: QueuedAction[] = [];

export function enqueueAction(type: string, payload: unknown): void {
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    timestamp: new Date().toISOString(),
  });
}

export function getQueue(): QueuedAction[] {
  return [...queue];
}

export function clearQueue(): void {
  queue = [];
}

export function flushQueue(): QueuedAction[] {
  const actions = [...queue];
  queue = [];
  return actions;
}

export async function processQueue(handler: (action: QueuedAction) => Promise<void>): Promise<void> {
  const actions = flushQueue();
  for (const action of actions) {
    try {
      await handler(action);
    } catch {
      enqueueAction(action.type, action.payload);
      break;
    }
  }
}
