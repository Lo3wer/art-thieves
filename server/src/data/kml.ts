import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import type { GameMap } from './types';

export interface MapImportOptions {
  name?: string;
  defaultZoom?: number;
  defaultVicinityRadius?: number;
  winThreshold?: number;
}

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
  filename: string,
  opts: MapImportOptions = {}
): Omit<GameMap, 'id' | 'createdAt'> {
  const kmlString = readKmlFromFile(buffer, filename);
  const { features, documentName } = parseFeatures(kmlString);
  const landmarks = features.filter((f) => f.properties?.type === 'landmark');
  if (landmarks.length === 0) {
    throw new Error('No landmark points found in the KML/KMZ file');
  }
  const { centerLat, centerLng } = computeCenter(features);
  return {
    name: opts.name?.trim() || documentName || 'Imported Map',
    centerLat,
    centerLng,
    defaultZoom: opts.defaultZoom ?? DEFAULT_ZOOM,
    defaultVicinityRadius: opts.defaultVicinityRadius ?? DEFAULT_VICINITY_RADIUS,
    winThreshold: opts.winThreshold ?? DEFAULT_WIN_THRESHOLD,
    data: { type: 'FeatureCollection', features },
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function dataXml(name: string, value: string): string {
  return `\n        <Data name="${escapeXml(name)}"><value>${escapeXml(value)}</value></Data>`;
}

function polygonXml(coords: number[][][]): string {
  const ring = coords.map((r) => r.map((c) => `${c[0]},${c[1]}`).join(' ')).join('\n          ');
  return `      <Polygon>
        <outerBoundaryIs>
          <LinearRing><coordinates>${ring}</coordinates></LinearRing>
        </outerBoundaryIs>
      </Polygon>`;
}

function featureToPlacemark(f: GeoFeature): string | null {
  const props = f.properties ?? {};
  const geom = f.geometry;
  let geometryXml = '';
  if (geom.type === 'Point') {
    const [lng, lat] = geom.coordinates as number[];
    geometryXml = `      <Point><coordinates>${lng},${lat}</coordinates></Point>`;
  } else if (geom.type === 'Polygon') {
    geometryXml = polygonXml(geom.coordinates as number[][][]);
  } else if (geom.type === 'MultiPolygon') {
    geometryXml = (geom.coordinates as number[][][][]).map(polygonXml).join('\n');
  } else {
    return null;
  }
  const data: string[] = [];
  if (props.challengeText) data.push(dataXml('challengeText', String(props.challengeText)));
  if (props.challenge) data.push(dataXml('challenge', JSON.stringify(props.challenge)));
  if (props.imageUrl) data.push(dataXml('imageUrl', String(props.imageUrl)));
  const extended = data.length ? `\n      <ExtendedData>${data.join('')}\n      </ExtendedData>` : '';
  return [
    '    <Placemark>',
    `      <name>${escapeXml(props.name ? String(props.name) : '')}</name>`,
    extended,
    geometryXml,
    '    </Placemark>',
  ]
    .filter((line) => line.trim() !== '')
    .join('\n');
}

export function mapDataToKml(map: Pick<GameMap, 'name' | 'data'>): string {
  const features = ((map.data as any)?.features ?? []) as GeoFeature[];
  const placemarks = features
    .map(featureToPlacemark)
    .filter((x): x is string => x !== null);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${escapeXml(map.name)}</name>`,
    ...placemarks,
    '  </Document>',
    '</kml>',
  ].join('\n');
}

export function mapsDirectory(): string {
  return path.join(__dirname, '..', '..', 'maps');
}

export function seedMapsFromDirectory(
  dir: string,
  target: { getMaps(): { name: string }[]; addMap(m: Omit<GameMap, 'id' | 'createdAt'>): unknown }
): void {
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
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
    if (!target.getMaps().some((m) => m.name === map.name)) {
      target.addMap(map);
      console.log(`[maps] Seeded map "${map.name}" from ${entry}`);
    }
  }
}