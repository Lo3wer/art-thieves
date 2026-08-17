import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { buildMapFromFile, mapDataToKml } from './kml';

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
    const map = buildMapFromFile(zip.toBuffer(), 'map.kmz', { name: 'Custom' });
    assert.equal(map.name, 'Custom');
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

  test('round-trips through mapDataToKml', () => {
    const map = buildMapFromFile(Buffer.from(SAMPLE_KML, 'utf-8'), 'map.kml');
    const kml = mapDataToKml(map);
    const reparsed = buildMapFromFile(Buffer.from(kml, 'utf-8'), 'roundtrip.kml');
    const original = (map.data as any).features;
    const restored = (reparsed.data as any).features;
    assert.equal(restored.length, original.length);
    assert.equal(restored[0].properties.name, original[0].properties.name);
    assert.equal(restored[0].properties.challengeText, original[0].properties.challengeText);
    assert.deepEqual(restored[0].properties.challenge, original[0].properties.challenge);
    assert.equal(restored[1].properties.name, original[1].properties.name);
    assert.equal(reparsed.centerLat, map.centerLat);
  });
});