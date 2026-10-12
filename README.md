<p align="center">
  <img src="./frontend/public/logo-headline.png" alt="DiveVault" width="420">
</p>

<p align="center">
  <a href="https://demo.divevault.dev">Try the demo</a>
  |
  <a href="#quick-start">Quick Start</a>
  |
  <a href="#screenshots">Screenshots</a>
  |
  <a href="#features">Features</a>
  |
  <a href="./docs/MIGRATION.md">Migration Guide</a>
  |
  <a href="./docs/DEVELOPMENT.md">Developer Docs</a>
</p>

## About This Fork (`unraid` branch)

This repository is an actively maintained, modernized fork of DiveVault tailored for self-hosting (Docker Compose on Unraid behind reverse proxies like NPMplus / CrowdSec):

- **Pure Go Backend**: The legacy Python backend and transitional rewrite shims have been completely removed. The backend is now a single, performant Go HTTP service located in [`backend/`](./backend).
- **Nuxt 4 Frontend**: Modernized Single-Page Application using Vue 3 Composition API, Nuxt UI, Tailwind CSS, domain stores (`useDivesStore`, `useProfileStore`), and native file-based page routing in `frontend/app/pages/`.
- **Direct In-Browser Dive Computer Download (WebSerial + Wasm)**: Connect your dive computer via USB/Serial and download telemetry directly inside your browser (Chrome/Edge) using an embedded WebAssembly build of [`libdivecomputer`](https://libdivecomputer.org/). No separate desktop agents or Python bridge scripts required.
- **Optimized Database Layer**: Selective telemetry SQL queries (slashing dive list network payloads by ~90%), server-side PostgreSQL aggregate statistics (`COUNT`, `SUM`, `MAX`, `AVG`), and non-destructive atomic profile updates (`ON CONFLICT ... DO UPDATE`).
- **Log Import & Migration**: Staged review queue for WebSerial computer downloads, spreadsheet CSV imports, and Subsurface XML/SSRF logs.
- **Proxy & AppSec Ready**: First-class support for `X-Forwarded-*` headers, secure cookie flags, and clean predictable API contracts suitable for CrowdSec AppSec / WAF inspection.

## Quick Start

The fastest way to run DiveVault is with Docker Compose:

```powershell
docker compose -f examples/docker/docker-compose.yml up
```

This starts PostgreSQL, runs the database migration job, and serves DiveVault at:

```text
http://localhost:8000
```

The published container runs the Go backend binary and serves the compiled frontend assets directly.

For production use (e.g. Unraid with NPMplus), review `.env.example` and configure your database credentials, JWT secrets, CORS origin, and reverse proxy headers.

## Screenshots

<p align="center">
  <img src="./docs/readme/dashboard.png" alt="DiveVault dashboard" width="900">
</p>

| Logbook | Import Queue |
| --- | --- |
| <img src="./docs/readme/logs.png" alt="Dive logs" width="440"> | <img src="./docs/readme/imports.png" alt="Import queue" width="440"> |

| Equipment | Settings |
| --- | --- |
| <img src="./docs/readme/equipment.png" alt="Equipment" width="440"> | <img src="./docs/readme/settings.png" alt="Settings" width="440"> |

## Features

- **Direct Dive Computer Download**: Read dive computers directly via WebSerial in supported browsers using compiled Wasm `libdivecomputer`.
- **Import Review Queue**: Review, validate, and enrich imported dive computer drafts before committing them into the logbook.
- **Detailed Dive Telemetry**: Visual profile charts, temperature curves, pressure tracking, SAC rates, location maps, buddies, guides, and equipment.
- **Manual Dive Entry**: Complete form with dive site autocomplete, gas mixtures, gear selection, and environmental conditions.
- **Dashboard & Maps**: Lifetime statistics computed via PostgreSQL aggregates, recent activity, and Leaflet world map with satellite imagery.
- **Data Management**: CSV and Subsurface export imports, CSV logbook exports, minimal PDF export, and full backup/restore archives.
- **Public Diver Profile**: Share selected logbook records and profile cards via public link.
- **Localization**: English, German, and French interface support.

## Import Workflow

DiveVault keeps raw imports separate from finished logbook entries. Imported dives arrive in a review queue where they can be enriched with missing metadata, corrected, or discarded. Once approved, the dive moves into the main logbook.

Imports can be triggered via:
1. **Direct USB/Serial**: Click *Connect Dive Computer* in the import screen to read directly from supported devices via WebSerial.
2. **File Imports**: Upload spreadsheet `.csv` files or Subsurface `.xml` / `.ssrf` / `.zip` exports from *Settings -> Data Management*.

See the [migration and import guide](./docs/MIGRATION.md) for CSV format specifications and Subsurface details.

## Developer Docs

Development setup, backend and frontend commands, testing, migrations, and architecture notes live in [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## License & Copyright

DiveVault is free software licensed under the [GNU General Public License v3.0](./LICENSE).

- **Original DiveVault Project**: Copyright &copy; jLemmings and contributors.
- **Go Backend Migration, WebSerial & WebAssembly Direct Import Integration**: Copyright &copy; 2026 Henry Winkler.
- **Dive Computer Driver Engine**: Powered by [libdivecomputer](https://libdivecomputer.org/), licensed under [LGPL-2.1](./THIRD_PARTY_LICENSES.md). See [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) for third-party notices, source availability, and rebuild instructions.

