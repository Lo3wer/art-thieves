import { API_BASE } from '../../api';
import { useTeamStore } from '../stores/useTeamStore';

export async function uploadPhoto(
  gameId: string,
  landmarkId: string,
  uri: string
): Promise<{ photoId: string; url: string }> {
  const teamId = useTeamStore.getState().myTeamId ?? '';
  const form = new FormData();
  form.append('photo', { uri, name: 'selfie.jpg', type: 'image/jpeg' } as any);
  form.append('teamId', teamId);
  form.append('landmarkId', landmarkId);

  const res = await fetch(`${API_BASE}/api/games/${gameId}/photos`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}