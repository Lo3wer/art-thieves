import { io, Socket } from 'socket.io-client';
import { Alert } from 'react-native';
import { API_BASE } from '../../api';
import { useGameStore } from '../stores/useGameStore';
import { useLocationStore } from '../stores/useLocationStore';
import { useTeamStore } from '../stores/useTeamStore';
import { useLogStore } from '../stores/useLogStore';
import { clearSession } from './session';

let socket: Socket | null = null;

function applyFrozenTeams(frozen: { teamId: string; frozenUntil: string }[]): void {
  const teamStore = useTeamStore.getState();
  const map: Record<string, string> = {};
  for (const item of frozen) map[item.teamId] = item.frozenUntil;
  teamStore.setFrozenTeams(map);
  const myId = teamStore.myTeamId;
  if (myId) {
    if (map[myId]) {
      teamStore.setFrozen(true, map[myId]);
    } else {
      teamStore.setFrozen(false);
      teamStore.setDisputeWindow(null);
    }
  }
}

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

  socket.on('state_update', (data: { game?: any; diff?: any }) => {
    if (data.game) {
      if (data.game.frozenTeams) applyFrozenTeams(data.game.frozenTeams);
      if (Array.isArray(data.game.locations)) {
        useLocationStore.getState().seedTeamLocations(data.game.locations);
      }
      useGameStore.getState().setGame(data.game);
    } else if (data.diff) {
      if (data.diff.frozenTeams) applyFrozenTeams(data.diff.frozenTeams);
      useGameStore.getState().applyDiff(data.diff);
    }
  });

  socket.on('log_entry', (entry: any) => {
    useLogStore.getState().append(entry);
  });

  socket.on('location_broadcast', (data: { teamId: string; latitude: number; longitude: number; timestamp: string }) => {
    useLocationStore.getState().updateTeamLocation(data);
  });

  socket.on('team_frozen', (data: { teamId: string; tagTimestamp: string; frozenUntil: string }) => {
    const myId = useTeamStore.getState().myTeamId;
    useTeamStore.getState().addFrozenTeam(data.teamId, data.frozenUntil);
    if (data.teamId === myId) {
      useTeamStore.getState().setFrozen(true, data.frozenUntil);
      const game = useGameStore.getState().game;
      if (game) {
        const disputeEnd = new Date(new Date(data.tagTimestamp).getTime() + (game.config.disputeWindow ?? 60) * 1000).toISOString();
        useTeamStore.getState().setDisputeWindow(disputeEnd);
      }
    }
  });

  socket.on('tag_disputed', (data: { teamId: string; taggerTeamId: string }) => {
    useTeamStore.getState().removeFrozenTeam(data.teamId);
    const myId = useTeamStore.getState().myTeamId;
    if (data.teamId === myId) {
      useTeamStore.getState().setFrozen(false);
      useTeamStore.getState().setDisputeWindow(null);
    }
    if (data.taggerTeamId === myId) {
      useTeamStore.getState().removeTagCooldown(data.teamId);
    }
  });

  socket.on('game_ended', (data: { winnerId: string | null; isTie: boolean }) => {
    useGameStore.getState().updateStatus('ended');
  });

  socket.on('team_kicked', (data: { teamId: string }) => {
    if (data.teamId === useTeamStore.getState().myTeamId) {
      useGameStore.getState().clearGame();
      useTeamStore.getState().clear();
      useLocationStore.getState().clearLocations();
      useLogStore.getState().clear();
      clearSession();
      if (socket) {
        socket.disconnect();
        socket = null;
      }
      Alert.alert('Removed', 'You were removed from the game by the host');
    }
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
