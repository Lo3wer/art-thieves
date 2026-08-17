import { File } from 'expo-file-system';
import { API_BASE } from '../../api';
import { useTeamStore } from '../stores/useTeamStore';
import { ApiError, NetworkError } from './errors';

export async function uploadPhoto(
  gameId: string,
  landmarkId: string,
  uri: string
): Promise<{ photoId: string; url: string }> {
  const teamId = useTeamStore.getState().myTeamId ?? '';
  const form = new FormData();
  form.append('photo', new File(uri));
  form.append('teamId', teamId);
  form.append('landmarkId', landmarkId);

  const url = `${API_BASE}/api/games/${gameId}/photos`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      body: form,
    });
  } catch (err) {
    const cause = err instanceof Error ? err : new Error(String(err));
    throw new NetworkError(url, `Network request failed: ${cause.message}`, err);
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message, undefined, url);
  }
  return res.json();
}
