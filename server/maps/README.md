# Map Format (KML/KMZ)

Every `.kml` or `.kmz` file in this directory is a game map. On server startup the
maps are seeded into the database automatically:

- A new file seeds a new map (map name = file name, e.g. `Downtown Vancouver.kmz` → `Downtown Vancouver`).
- A changed file updates the existing map in place (detected via a content fingerprint, preserves the map id).
- A removed file removes the map from the database.

No manual database work is needed — edit the file and restart the server.

## Placemark conventions

| Geometry | Meaning |
| -------- | ------- |
| `Point`  | A landmark (one challenge per landmark) |
| `Polygon` / `MultiPolygon` | The game boundary (visual only) |

A map must contain at least one `Point` placemark.

## Landmark fields

Each landmark placemark may carry an `<ExtendedData>` block with the following
standardized fields. The importer reads them in this priority order.

```xml
<Placemark>
  <name>Search</name>
  <description>Artwork info and reference links (shown in Google Earth; fallback only)</description>
  <ExtendedData>
    <Data name="challengeText"><value>The instructions shown to players.</value></Data>
    <Data name="challenge"><value>{"text":"...","mode":"instant",...}</value></Data>
    <Data name="imageUrl"><value>https://example.com/artwork.jpg</value></Data>
  </ExtendedData>
  <styleUrl>#icon-1899-0288D1</styleUrl>
  <Point><coordinates>-123.133881,49.293017,0</coordinates></Point>
</Placemark>
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `challengeText` | string | The challenge instructions displayed in the app. |
| `challenge` | JSON string | Structured challenge spec (see below). When present it drives the app's complete/veto/penalty/timer UI. |
| `imageUrl` | string, optional | Photo of the artwork. |
| `description` | string | Artwork info / reference links. Used as the challenge text only when `challengeText` is absent. |

On import the `challenge` JSON is validated against `challengeSpecSchema`
(`server/src/middleware/validation.ts`). Invalid JSON or an invalid spec is logged
and ignored — the landmark then falls back to `challengeText`.

## Challenge spec (JSON in `challenge`)

Shape matches `ChallengeSpec` in `server/src/data/types.ts`.

### Instant (default)

```json
{
  "text": "Do the thing to lock this landmark.",
  "mode": "instant"
}
```

### Instant with a penalty + veto

```json
{
  "text": "You may instantly lock this landmark, but you lose access to your tracker for 30 minutes. Alternatively, you may veto this challenge to avoid the tracker penalty, but you will not lock this landmark.",
  "mode": "instant",
  "instant": {
    "completeLabel": "Lock now (lose tracker 30 min)",
    "vetoLabel": "Veto (don't lock)",
    "vetoNote": "No tracker penalty, but this landmark is not locked.",
    "penalty": {
      "type": "tracker",
      "minutes": 30,
      "note": "Your team has lost access to its tracker for 30 minutes."
    }
  }
}
```

`penalty.type` is `"tracker"` or `"transit"`.

### Delayed (return later)

```json
{
  "text": "Return here at least one hour from now to lock it.",
  "mode": "delayed",
  "delayed": {
    "delayMinutes": 60,
    "returnToLandmark": true,
    "failsIfLockedByOtherTeam": true
  }
}
```

Optional `delayed` fields: `preCondition` (extra instruction), `requiresPhoto`
(forces a proof photo on completion).

## Example placemark

```xml
<Placemark>
  <name>Time Top</name>
  <description><![CDATA[Jerry Pethick, 2006<br>https://covapp.vancouver.ca/PublicArtRegistry/ArtworkDetail.aspx?ArtworkId=358]]></description>
  <ExtendedData>
    <Data name="challengeText"><value>The Time Top is now waiting for you in the future. To lock this Landmark, return to Time Top at least one hour from now.</value></Data>
    <Data name="challenge"><value>{"text":"The Time Top is now waiting for you in the future. To lock this Landmark, return to Time Top at least one hour from now.","mode":"delayed","delayed":{"delayMinutes":60,"returnToLandmark":true,"failsIfLockedByOtherTeam":true}}</value></Data>
  </ExtendedData>
  <styleUrl>#icon-1899-0288D1</styleUrl>
  <Point>
    <coordinates>-123.115695,49.272571,0</coordinates>
  </Point>
</Placemark>
```

## Editing workflow

1. Edit the map in Google Earth (or extract `doc.kml` from the KMZ and edit the XML directly, then re-zip).
2. Keep landmark names exactly matching the challenge list in `challenges.md`.
3. Restart the server — it logs `[maps] Updated map "..."` when a file changed, or `[maps] Skipping ...` with a reason when a file is invalid.

## Tests

Map import, ExtendedData parsing, challenge validation, and the seed/update
behaviour are covered in `server/src/data/kml.test.ts` (`npm test` in `server/`).
