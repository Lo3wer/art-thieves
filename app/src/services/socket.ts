import { io, Socket } from 'socket.io-client';
import { API_BASE } from '../../api';
import { useGameStore } from '../stores/useGameStore';
import { useLocationStore } from '../stores/useLocationStore';
import { useTeamStore } from '../stores/useTeamStore';

let socket: Socket | null = null;

export function connectSocket(gameId: string, teamId: string): Socket {
  if (socket?.connected) {
    socket.emit('join_game', { gameId, teamId });
    return socket;
  }

  socket = io(`${API_BASE}/game`, {
    transports: ['websocket'],
    autoConnect: true,
  });

  socket.on('connect', () => {
    socket?.emit('join_game', { gameId, teamId });
  });

  socket.on('state_update', (data: { game: any }) => {
    useGameStore.getState().setGame(data.game);
  });

  socket.on('location_broadcast', (data: { teamId: string; latitude: number; longitude: number; timestamp: string }) => {
    useLocationStore.getState().updateTeamLocation(data);
  });

  socket.on('team_frozen', (data: { teamId: string }) => {
    const myId = useTeamStore.getState().myTeamId;
    if (data.teamId === myId) {
      useTeamStore.getState().setFrozen(true, new Date(Date.now() + 10 * 60 * 1000).toISOString());
    }
  });

  socket.on('tag_disputed', (data: { teamId: string }) => {
    const myId = useTeamStore.getState().myTeamId;
    if (data.teamId === myId) {
      useTeamStore.getState().setFrozen(false);
    }
  });

  socket.on('game_ended', (data: { winnerId: string | null; isTie: boolean }) => {
    useGameStore.getState().updateStatus('ended');
  });

  socket.on('game_paused', () => {
    useGameStore.getState().updateStatus('paused');
  });

  socket.on('game_resumed', () => {
    useGameStore.getState().updateStatus('active');
  });

  socket.on('error', (data: { message: string }) => {
    console.warn('Socket error:', data.message);
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function emitLocation(lat: number, lng: number): void {
  socket?.emit('location_update', { latitude: lat, longitude: lng });
}
