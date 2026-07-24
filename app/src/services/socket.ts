import { io, Socket } from 'socket.io-client';
import { API_BASE } from '../../api';

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
