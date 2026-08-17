import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import type { GameMap } from './types';

interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown };
}

const DEFAULT_ZOOM = 14;
const DEFAULT_VICINITY_RADIUS = 30;
const DEFAULT_WIN_THRESHOLD = 20;
const FALLBACK_CENTER = { lat: 49.2827, lng: -123.1207 };

function readKmlFromFile(buffer: Buffer, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'kmz') {
    const zip = new AdmZip(buffer);
    const entry = zip
      .getEntries()
      .find((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.kml'));
    if (!entry) throw new Error('No KML file found inside the KMZ archive');
    return entry.getData().toString('utf-8');
  }
  return buffer.toString('utf-8');
}

function tryParseJson(s: string): unknown {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

function to2d(c: number[]): number[] {
  return c.slice(0, 2);
}

function documentNameOf(doc: any): string | null {
  const names = doc.getElementsByTagName('name');
  for (let i = 0; i < names.length; i++) {
    const node = names.item(i);
    const parent = node?.parentNode;
    const parentName = parent?.nodeName ?? '';
    if (parentName === 'Document' || parentName === 'kml' || parentName === 'Folder') {
      const text = node?.textContent?.trim();
      if (text) return text;
    }
  }
  return null;
}

function descriptionText(description: unknown): string | undefined {
  if (typeof description === 'string' && description.trim()) return description.trim();
  if (
    description &&
    typeof description === 'object' &&
    typeof (description as any).value === 'string' &&
    (description as any).value.trim()
  ) {
    return (description as any).value.trim();
  }
  return undefined;
}

function parseFeatures(kmlString: string): { features: GeoFeature[]; documentName: string | null } {
  const doc = new DOMParser().parseFromString(kmlString, 'text/xml');
  const collection = kmlToGeoJson(doc);
  const features: GeoFeature[] = [];
  const documentName = documentNameOf(doc);

  const push = (
    props: Record<string, unknown>,
    geomType: string,
    classification: string,
    coordinates: unknown
  ) => {
    const name =
      typeof props.name === 'string' && props.name.trim() ? props.name.trim() : undefined;
    const challenge = typeof props.challenge === 'string' ? tryParseJson(props.challenge) : undefined;
    const challengeText = props.challengeText
      ? String(props.challengeText)
      : descriptionText(props.description);
    const imageUrl = props.imageUrl ? String(props.imageUrl) : undefined;
    const p: Record<string, unknown> = { type: classification };
    if (name) p.name = name;
    if (challengeText) p.challengeText = challengeText;
    if (challenge) p.challenge = challenge;
    if (imageUrl) p.imageUrl = imageUrl;
    features.push({ type: 'Feature', properties: p, geometry: { type: geomType, coordinates } });
  };

  for (const raw of collection.features) {
    const geom = (raw as any).geometry;
    if (!geom) continue;
    const props = (raw as any).properties ?? {};
    if (geom.type === 'Point') {
      push(props, 'Point', 'landmark', to2d(geom.coordinates));
    } else if (geom.type === 'Polygon') {
      push(props, 'Polygon', 'boundary', geom.coordinates.map((ring: number[][]) => ring.map(to2d)));
    } else if (geom.type === 'MultiPolygon') {
      push(
        props,
        'MultiPolygon',
        'boundary',
        geom.coordinates.map((poly: number[][][]) => poly.map((ring: number[][]) => ring.map(to2d)))
      );
    } else if (geom.type === 'GeometryCollection') {
      for (const sub of geom.geometries) {
        if (sub.type === 'Point') push(props, 'Point', 'landmark', to2d(sub.coordinates));
        else if (sub.type === 'Polygon') {
          push(props, 'Polygon', 'boundary', sub.coordinates.map((ring: number[][]) => ring.map(to2d)));
        }
      }
    }
  }
  return { features, documentName };
}

function computeCenter(features: GeoFeature[]): { centerLat: number; centerLng: number } {
  const points = features
    .filter((f) => f.properties?.type === 'landmark')
    .map((f) => f.geometry.coordinates as number[]);
  if (points.length > 0) {
    const lats = points.map((c) => c[1]);
    const lngs = points.map((c) => c[0]);
    return {
      centerLat: (Math.min(...lats) + Math.max(...lats)) / 2,
      centerLng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
  }
  return { centerLat: FALLBACK_CENTER.lat, centerLng: FALLBACK_CENTER.lng };
}

export function buildMapFromFile(
  buffer: Buffer,
  filename: string
): Omit<GameMap, 'id' | 'createdAt'> {
  const kmlString = readKmlFromFile(buffer, filename);
  const { features, documentName } = parseFeatures(kmlString);
  const landmarks = features.filter((f) => f.properties?.type === 'landmark');
  if (landmarks.length === 0) {
    throw new Error('No landmark points found in the KML/KMZ file');
  }
  const { centerLat, centerLng } = computeCenter(features);
  const baseName = path.basename(filename).replace(/\.[^.]+$/, '');
  return {
    name: baseName || documentName || 'Imported Map',
    centerLat,
    centerLng,
    defaultZoom: DEFAULT_ZOOM,
    defaultVicinityRadius: DEFAULT_VICINITY_RADIUS,
    winThreshold: DEFAULT_WIN_THRESHOLD,
    data: { type: 'FeatureCollection', features },
  };
}

export function mapsDirectory(): string {
  return path.join(__dirname, '..', '..', 'maps');
}

export function seedMapsFromDirectory(
  dir: string,
  target: {
    getMaps(): { name: string }[];
    addMap(m: Omit<GameMap, 'id' | 'createdAt'>): unknown;
    deleteMap(name: string): void;
  }
): void {
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const available: string[] = [];
  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (ext !== '.kml' && ext !== '.kmz') continue;
    const filePath = path.join(dir, entry);
    let map: Omit<GameMap, 'id' | 'createdAt'>;
    try {
      map = buildMapFromFile(fs.readFileSync(filePath), entry);
    } catch (err: any) {
      console.warn(`[maps] Skipping ${entry}: ${err.message}`);
      continue;
    }
    available.push(map.name);
    if (!target.getMaps().some((m) => m.name === map.name)) {
      target.addMap(map);
      console.log(`[maps] Seeded map "${map.name}" from ${entry}`);
    }
  }
  for (const existing of target.getMaps()) {
    if (!available.includes(existing.name)) {
      target.deleteMap(existing.name);
      console.log(`[maps] Removed map "${existing.name}" (not present in ${dir})`);
    }
  }
}