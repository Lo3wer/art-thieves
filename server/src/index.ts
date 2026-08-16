import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { networkInterfaces } from 'os';
import { errorHandler } from './middleware/errorHandler';
import routes from './routes';
import { registerGameHandlers } from './socket/handlers';
import { setIO } from './socket/broadcast';
import { initDb, isPersistent, getUploadsDir } from './data/db';

if (isPersistent()) {
  initDb();
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(getUploadsDir()));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use('/api', routes);

setIO(io);
registerGameHandlers(io);

app.use(errorHandler);

server.listen(PORT, '0.0.0.0', () => {
  const nets = networkInterfaces();
  const ip =
    Object.values(nets)
      .flat()
      .find((n) => n && n.family === 'IPv4' && !n.internal)
      ?.address ?? 'unknown';
  console.log(`Server running on http://localhost:${PORT} (LAN: http://${ip}:${PORT})`);
});
