import express from 'express';
import cors from 'cors';
import http from 'http';
import { networkInterfaces } from 'os';
import { errorHandler } from './middleware/errorHandler';
import routes from './routes';

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.use(cors());
app.use(express.json());

app.use('/api', routes);

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
