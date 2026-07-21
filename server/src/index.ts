import express from 'express';
import cors from 'cors';
import { networkInterfaces } from 'os';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

type Heist = {
  id: number;
  title: string;
  location: string;
  date: string;
};

let heists: Heist[] = [
  { id: 1, title: 'The Great Vancouver Art Heist', location: 'Vancouver Art Gallery', date: '2026-03-15' },
  { id: 2, title: 'The Night Gallery Job', location: 'Chali-Rosso Gallery', date: '2026-06-22' },
];

app.get('/api/heists', (_req, res) => {
  res.json(heists);
});

app.get('/api/heists/:id', (req, res) => {
  const heist = heists.find(h => h.id === parseInt(req.params.id));
  if (!heist) {
    res.status(404).json({ error: 'Heist not found' });
    return;
  }
  res.json(heist);
});

app.post('/api/heists', (req, res) => {
  const { title, location, date } = req.body;
  if (!title || !location || !date) {
    res.status(400).json({ error: 'title, location, and date are required' });
    return;
  }
  const heist: Heist = { id: heists.length + 1, title, location, date };
  heists.push(heist);
  res.status(201).json(heist);
});

app.listen(PORT, '0.0.0.0', () => {
  const nets = networkInterfaces();
  const ip = Object.values(nets).flat().find(n => n && n.family === 'IPv4' && !n.internal)?.address || 'unknown';
  console.log(`Vancouver Art Thieves server running on http://localhost:${PORT} (LAN: http://${ip}:${PORT})`);
});
