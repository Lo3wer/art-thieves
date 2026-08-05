import { create } from 'zustand';
import type { LogEntry } from '../types';

interface LogStore {
  entries: LogEntry[];
  setEntries: (entries: LogEntry[]) => void;
  append: (entry: LogEntry) => void;
  clear: () => void;
}

export const useLogStore = create<LogStore>((set) => ({
  entries: [],
  setEntries: (entries) => set({ entries }),
  append: (entry) =>
    set((s) =>
      s.entries.some((e) => e.id === entry.id)
        ? s
        : { entries: [entry, ...s.entries] }
    ),
  clear: () => set({ entries: [] }),
}));