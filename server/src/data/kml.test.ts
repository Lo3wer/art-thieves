import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { buildMapFromFile, seedMapsFromDirectory, mapFingerprint } from './kml';

const SAMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Vancouver Art Walk</name>
    <Folder>
      <name>Landmarks</name>
      <Placemark>
        <name>Gastown</name>
        <description>Find the clock</description>
        <ExtendedData>
          <Data name="challengeText"><value>Look for the hidden detail</value></Data>
          <Data name="challenge"><value>{"text":"Return later","mode":"delayed","delayed":{"delayMinutes":60,"returnToLandmark":true}}</value></Data>
          <Data name="imageUrl"><value>http://example.com/clock.jpg</value></Data>
        </ExtendedData>
        <Point><coordinates>-123.111,49.2845,0</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>Yaletown</name>
        <Point><coordinates>-123.121,49.2745</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>Boundary</name>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing><coordinates>-123.2,49.3 -123.0,49.3 -123.0,49.2 -123.2,49.2 -123.2,49.3</coordinates></LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>
    </Folder>
  </Document>
</kml>`;

describe('kml map import', () => {
  test('parses points, polygons and ExtendedData into a FeatureCollection', () => {
    const map = buildMapFromFile(Buffer.from(SAMPLE_KML, 'utf-8'), 'Downtown Walk.kml');
    const features = (map.data as any).features;

    assert.equal(map.name, 'Downtown Walk');
    assert.equal(features.length, 3);

    const landmark = features[0];
    assert.equal(landmark.properties.type, 'landmark');
    assert.equal(landmark.properties.name, 'Gastown');
    assert.equal(landmark.properties.challengeText, 'Look for the hidden detail');
    assert.equal(landmark.properties.imageUrl, 'http://example.com/clock.jpg');
    assert.deepEqual(landmark.properties.challenge, {
      text: 'Return later',
      mode: 'delayed',
      delayed: { delayMinutes: 60, returnToLandmark: true },
    });
    assert.deepEqual(landmark.geometry.coordinates, [-123.111, 49.2845]);

    const boundary = features[2];
    assert.equal(boundary.properties.type, 'boundary');
    assert.equal(boundary.geometry.type, 'Polygon');
    assert.equal(boundary.geometry.coordinates[0].length, 5);
  });

  test('falls back to description when challengeText column is absent', () => {
    const map = buildMapFromFile(
      Buffer.from(
        SAMPLE_KML.replace('<Data name="challengeText"><value>Look for the hidden detail</value></Data>', ''),
        'utf-8'
      ),
      'map.kml'
    );
    const landmark = (map.data as any).features[0];
    assert.equal(landmark.properties.challengeText, 'Find the clock');
  });

  test('derives center from landmark bounding box', () => {
    const map = buildMapFromFile(Buffer.from(SAMPLE_KML, 'utf-8'), 'map.kml');
    assert.equal(map.centerLat, (49.2845 + 49.2745) / 2);
    assert.equal(map.centerLng, (-123.111 + -123.121) / 2);
  });

  test('accepts KMZ archives', () => {
    const zip = new AdmZip();
    zip.addFile('doc.kml', Buffer.from(SAMPLE_KML, 'utf-8'));
    const map = buildMapFromFile(zip.toBuffer(), 'map.kmz');
    assert.equal(map.name, 'map');
    assert.equal((map.data as any).features.length, 3);
  });

  test('rejects files with no landmark points', () => {
    const boundaryOnly = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>Boundary Only</name>
    <Placemark><name>Boundary</name>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>-123,49 -122,49 -122,48 -123,48 -123,49</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
  </Document>
</kml>`;
    assert.throws(
      () => buildMapFromFile(Buffer.from(boundaryOnly, 'utf-8'), 'boundary.kml'),
      /No landmark points/
    );
  });

  test('drops invalid challenge JSON but keeps the fallback challengeText', () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>Broken</name>
    <Placemark>
      <name>Broken Challenge</name>
      <ExtendedData>
        <Data name="challengeText"><value>Do the thing</value></Data>
        <Data name="challenge"><value>{not json</value></Data>
      </ExtendedData>
      <Point><coordinates>-123.1,49.28</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
    const map = buildMapFromFile(Buffer.from(kml, 'utf-8'), 'broken.kml');
    const landmark = (map.data as any).features[0];
    assert.equal(landmark.properties.challengeText, 'Do the thing');
    assert.equal(landmark.properties.challenge, undefined);
  });

  test('drops challenge specs that fail schema validation', () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>Invalid Spec</name>
    <Placemark>
      <name>Bad Mode</name>
      <ExtendedData>
        <Data name="challengeText"><value>Do the thing</value></Data>
        <Data name="challenge"><value>{"text":"x","mode":"sometimes"}</value></Data>
      </ExtendedData>
      <Point><coordinates>-123.1,49.28</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
    const map = buildMapFromFile(Buffer.from(kml, 'utf-8'), 'invalid-spec.kml');
    const landmark = (map.data as any).features[0];
    assert.equal(landmark.properties.challenge, undefined);
    assert.equal(landmark.properties.challengeText, 'Do the thing');
  });

  test('accepts a valid instant challenge spec with a penalty', () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>Penalty</name>
    <Placemark>
      <name>Tracker Curse</name>
      <ExtendedData>
        <Data name="challenge"><value>{"text":"Lock now or veto","mode":"instant","instant":{"vetoLabel":"Veto","penalty":{"type":"tracker","minutes":30,"note":"no tracker"}}}</value></Data>
      </ExtendedData>
      <Point><coordinates>-123.1,49.28</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
    const map = buildMapFromFile(Buffer.from(kml, 'utf-8'), 'penalty.kml');
    const landmark = (map.data as any).features[0];
    assert.deepEqual(landmark.properties.challenge, {
      text: 'Lock now or veto',
      mode: 'instant',
      instant: {
        vetoLabel: 'Veto',
        penalty: { type: 'tracker', minutes: 30, note: 'no tracker' },
      },
    });
  });

  test('seedMapsFromDirectory updates an existing map when the file changes and preserves its id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vat-maps-'));
    try {
      const rows: any[] = [];
      const target = {
        getMaps: () => rows,
        addMap: (m: any) => {
          const row = { ...m, id: 'fixed-id', createdAt: '2026-01-01T00:00:00.000Z' };
          rows.push(row);
          return row;
        },
        updateMap: (name: string, m: any) => {
          const idx = rows.findIndex((r) => r.name === name);
          rows[idx] = { ...m, id: rows[idx].id, createdAt: rows[idx].createdAt };
          return rows[idx];
        },
        deleteMap: (name: string) => {
          const idx = rows.findIndex((r) => r.name === name);
          if (idx !== -1) rows.splice(idx, 1);
        },
      };

      fs.writeFileSync(path.join(dir, 'Game.kml'), SAMPLE_KML);
      seedMapsFromDirectory(dir, target);
      assert.equal(rows.length, 1);
      const seeded = rows[0];

      const changed = SAMPLE_KML.replace('Look for the hidden detail', 'Look for the NEW detail');
      fs.writeFileSync(path.join(dir, 'Game.kml'), changed);
      seedMapsFromDirectory(dir, target);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, 'fixed-id');
      assert.notEqual(mapFingerprint(rows[0]), mapFingerprint(seeded));

      seedMapsFromDirectory(dir, target);
      assert.equal(rows.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});