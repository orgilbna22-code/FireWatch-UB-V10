# FIREWATCH UB — Pilot Data Import & Batch Sync Specification

> **Status:** Architecture ready behind `ADMIN_TOKEN` Bearer authentication. Bundled UI records remain **DEMO / MODELLED** unless explicitly replaced by verified pilot partner data.

---

## 1. Authentication & Security Requirements

All write and batch-import endpoints are disabled for anonymous public visitors:

- Required header: `Authorization: Bearer <ADMIN_TOKEN>` (validated using constant-time comparison against server `process.env.ADMIN_TOKEN`).
- Requests without a valid token return `401` / `403`.
- Payload limits:
  - Maximum JSON body size: **256 KB** (`413 Payload Too Large` otherwise).
  - Maximum records per batch sync request: **200** (`400 Bad Request` otherwise).
  - Rate limit: **30 write requests/minute per IP**.

---

## 2. Batch Sync Endpoint (`POST /api/v1/incidents/batch-sync`)

### Accepted Input Formats

#### A. GeoJSON `FeatureCollection` (Recommended for GIS / NEMA exports)

Note GeoJSON coordinate order is `[longitude, latitude]`.

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "pilot-2026-01",
      "geometry": { "type": "Point", "coordinates": [107.0112, 47.9408] },
      "properties": {
        "date": "2026-11-15",
        "districtId": "bayanzurkh",
        "khorooNumber": 27,
        "category": "residential_ger",
        "severity": "critical",
        "causeGuessMn": "Зуухны яндангийн цонолт",
        "causeGuessEn": "Stove flue overheating",
        "responseTimeMin": 11
      }
    }
  ]
}
```

#### B. JSON Array or `{ "incidents": [...] }`

Each element accepts:

| Field | Type | Constraints / Allowed Values |
| :--- | :--- | :--- |
| `id` | `string` (optional) | `[a-zA-Z0-9._:-]{1,64}` |
| `date` | `string` | `YYYY-MM-DD` |
| `districtId` | `string` (**required**) | Lowercase ID (`bayanzurkh`, `songinokhairkhan`, `chingeltei`, `sukhbaatar`, `bayangol`, `khan-uul`, `nalaikh`, `baganuur`, `bagakhangai`) |
| `khorooNumber` | `number` | Integer `1..60` (defaults to `1`) |
| `category` | `string` | `residential_ger`, `residential_apt`, `electrical`, `grass_forest`, `commercial` |
| `severity` | `string` | `minor`, `moderate`, `critical` |
| `causeGuessMn` | `string` (**required**) | 1–180 chars (alias `description` accepted) |
| `causeGuessEn` | `string` (optional) | 1–180 chars |
| `responseTimeMin` | `number` | Integer `2..90` |
| `lat` | `number` | Validated inside `46.0..50.0` (falls back to district centroid if out of bounds) |
| `lng` | `number` | Validated inside `104.0..111.0` (falls back to district centroid if out of bounds) |

---

## 3. Single-Record CRUD Endpoints

- `POST /api/incidents` — Insert a single record (returns `201`)
- `PUT /api/incidents/:id` — Update an existing record by ID
- `DELETE /api/incidents/:id` — Remove an existing record by ID

---

## 4. PII & Privacy Restrictions (Mandatory)

**Never import personally identifiable information (PII).** Before exporting CSV/GeoJSON from any agency dispatch log:

1. Strip caller names, phone numbers, national ID numbers, and exact apartment/fence door numbers.
2. Round coordinates to at most 4–5 decimal places (or aggregate to khoroo centroid) if citizen residence privacy requires spatial generalization.
3. Verify `Data-Quality Readiness Check` in the admin panel after upload (`Missing/Invalid Coords = 0`, `Unknown Cause` reviewed).

---

## 5. CSV-to-GeoJSON Workflow (Offline Prep)

If pilot partner spreadsheets arrive in `.csv` format:

1. Remove PII columns (`Caller_Name`, `Phone`, `Street_House_No`).
2. Normalize District names to the 9 canonical lowercase `districtId` slugs.
3. Convert rows to GeoJSON `FeatureCollection` or JSON array and upload via **Data Governance → Admin Access → Pilot Batch Import** (`#sources`).
4. Switch `Active Dataset Scope` to **Imported** so Fire Command tables and exports separate real imported rows from bundled demo baselines.
