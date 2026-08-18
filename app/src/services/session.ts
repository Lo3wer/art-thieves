import { File, Paths } from 'expo-file-system';

export interface Session {
  gameId: string;
  teamId: string;
}

function sessionFile(): File {
  return new File(Paths.document, 'vat-session.json');
}

export async function saveSession(session: Session): Promise<void> {
  try {
    sessionFile().write(JSON.stringify(session));
  } catch {
    // best-effort; session persistence is optional
  }
}

export async function loadSession(): Promise<Session | null> {
  try {
    const file = sessionFile();
    if (!file.exists) return null;
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.gameId === 'string' && typeof parsed.teamId === 'string') {
      return { gameId: parsed.gameId, teamId: parsed.teamId };
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    const file = sessionFile();
    if (file.exists) file.delete();
  } catch {
    // best-effort
  }
}