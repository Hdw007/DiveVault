# Architecture Audit & Refactoring Roadmap

This document captures the architectural evaluation of the DiveVault codebase, identifies its weakest links and core design bottlenecks, and defines a phased modernization plan to transition from ad-hoc surgical fixes to a clean, maintainable architecture.

---

## 1. Context & Motivation

DiveVault was built as a hybrid Go HTTP service and Nuxt 4 single-page application. While the core feature set is functional, the upstream codebase grew as an early-stage prototype:
- Framework capabilities (Vue 3 Composition API, Nuxt routing/pages, PostgreSQL relational modeling) were bypassed in favor of monolithic "god components" and unstructured JSON blobs.
- Maintenance upstream has stalled, with unresolved bugs across form validation, dropdown menus, stats calculations, and importer scripts.
- To make this fork robust for self-hosting (Docker on Unraid behind NPMplus and CrowdSec), we are adopting a structured, domain-level modernization approach rather than accumulating band-aids.

---

## 2. Weakest Links & Pressing Architectural Issues

### 2.1 Frontend: The "God Component" Monolith (`AppRouteController.vue` & `Settings.vue`)
- **AppRouteController.vue (2,076 lines)**:
  - Bypasses Nuxt's router by pointing all routes to `NuxtRouteShell.vue` (a dummy `<span hidden>` element).
  - Manually parses URL paths and query strings using regular expressions (`routeToState`) and switches screens via top-level `v-if="activeView === ..."`.
  - Holds over 30 separate reactive variables (dives, drafts, equipment, profile, filters, modals, sync codes).
  - Acts as the sole network orchestrator, passing 15–20 props and callback functions down through multiple layers of components (prop-drilling).
- **Settings.vue (2,371 lines)**:
  - Exposes its raw component instance to child tabs via `provide() { return { settingsContext: this } }`.
  - Mixes profile drafts, license uploads, dive site maps, buddy management, guide lists, backup exports, and user administration into a single mega-controller.
- **Impact**: Any state update causes cascading re-render evaluations across unrelated views. Diagnosing state desyncs or caching glitches is high-friction and bug-prone.

### 2.2 Performance & Memory: Over-fetching Dive Telemetry Samples
- **Issue**:
  - `fetchDives(api)` in `frontend/app/shared/api/dives.js` defaults to `query = "limit=250&include_samples=1"`.
  - Every view change or list refresh loads full 1-second telemetry profiles (thousands of depth and temperature points per dive) for up to 250 dives simultaneously.
  - Vue wraps every telemetry coordinate in deep reactive proxies, storing hundreds of thousands of reactive objects in memory.
- **Impact**: Noticeable UI thread stutter, laggy dropdown closes/clicks, browser memory bloat, and potential event handler timeouts during form interactions. Telemetry samples are only needed on `DiveDetail.vue` when viewing a specific profile chart.

### 2.3 Fragile Duplication: Triplication of Dive Entry/Edit Forms
- **Issue**:
  - `ManualDive.vue` (794 lines) — Create a new dive entry.
  - `ImportEdit.vue` (1,110 lines) — Edit an imported dive before committing.
  - `LogbookEdit.vue` (598 lines) — Edit an existing committed dive.
  - All three components implement 80% identical form fields, validations (pressure bounds, date/time formats, duration), dive site autocompletes, and inline creation modals.
- **Impact**: A bug fixed in `ManualDive` (such as autocomplete popover closures or required field checks) remains broken in `ImportEdit` and `LogbookEdit`. Diverging behaviors create a disjointed user experience.

### 2.4 Database & Backend: Destructive Profile Deletes & Memory Waste
- **Unoptimized SQL in `ListDives`**:
  - In `backend/internal/store/domain.go`, `ListDives` queries `raw_data` (BYTEA) and `samples_json` (JSONB) on *every single query*, regardless of whether samples or raw data were requested. It parses the JSON in memory before discarding the fields.
- **Destructive Profile Saves**:
  - In `SaveUserProfile`, whenever any profile setting is modified, `replaceProfileCollection` executes `DELETE FROM user_profile_dive_sites WHERE user_id=$1;` (and similarly for buddies and guides) and re-inserts all items in a loop with newly generated fallback IDs.
- **Lack of Relational Integrity**:
  - Dives store sites, buddies, and gear as loose string names inside `fields_json -> logbook` without foreign key relationships. Renaming a site or buddy in settings leaves existing dives referencing outdated strings.

### 2.5 Importers & Statistical Computations
- Importers (CSV and Subsurface) parse entries into ad-hoc JSON without standardized timezone normalization, causing duplicate dive records.
- Statistics are computed in Go by iterating over all dive structs in memory, or in JavaScript as a fallback, rather than utilizing fast PostgreSQL SQL aggregation functions.

---

## 3. Four-Phase Modernization Plan

Status Legend:
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked or needs decision

---

### Phase 1: High-Impact Performance & Database Safety (Immediate)
*Goal: Eliminate UI thread lag, reduce network payloads by ~90%, and prevent database churn.*

- [x] **1.1 Lightweight Dive Listing (Frontend)**
  - Update `fetchDives` in `frontend/app/shared/api/dives.js` to default to `include_samples=0`.
  - Update `DiveDetail.vue` to fetch the full dive payload (`GET /api/dives/:id?include_samples=1`) on mount.
  - Verify dashboard, logs list, and import queue remain fully functional with lightweight payloads.
- [x] **1.2 Selective SQL Queries (Backend)**
  - Modify `ListDives` and `ListAllDives` in `backend/internal/store/domain.go` to exclude `raw_data` and `samples_json` from the SQL `SELECT` statement unless `includeSamples` or `includeRawData` is true.
  - Keep `GetDive(id)` loading full data for detail views.
- [x] **1.3 Non-Destructive Profile Updates (Backend)**
  - Refactor `replaceProfileCollection` in `backend/internal/store/domain.go` to use atomic UPSERT (`ON CONFLICT (user_id, <id_col>) DO UPDATE`) and transactional deletion of only removed IDs, preserving existing IDs and avoiding table-wide deletes.
- [x] **1.4 Verification**
  - Run full backend Go test suite (`go test ./backend/...`).
  - Run full Playwright test suite (`cd frontend && npm test`).

---

### Phase 2: Unified Dive Form & Shared Component Architecture
*Goal: Eliminate triplication of dive editing logic and standardize form validations.*

- [x] **2.1 Shared Dive Form Draft Composable**
  - Create `frontend/app/shared/composables/use-dive-form.js` to encapsulate:
    - Validation logic (duration, depth, pressure ranges, required fields).
    - Autocomplete selection and inline site/buddy creation state.
    - Gas mix and equipment payload formatting.
- [x] **2.2 Unified `DiveForm` Component**
  - Create `frontend/app/shared/components/dive-form/DiveFormFields.vue` containing the shared fields:
    - Date, time, duration, depths.
    - Site autocomplete with map preview.
    - Buddy, guide, and equipment selectors.
    - Tank volume, start/end pressure, gas mix, weights, and conditions.
- [x] **2.3 Refactor Form Consumers**
  - Migrate `ManualDive.vue` to use the unified component.
  - Migrate `ImportEdit.vue` to use the unified component.
  - Migrate `LogbookEdit.vue` to use the unified component.
- [x] **2.4 Verification**
  - Verify dive creation, import staging, and logbook updates across all test suites.
  - Fix tank pressure persistence bug in backend and frontend.

---

### Phase 3: Frontend State Decoupling (Decomposing the Monolith)
*Goal: Remove the god-component anti-pattern and enable clean view-level state.*

- [x] **3.1 Domain Composables**
  - Implement `useDivesStore`: encapsulates dives list, active filters, search, pagination, stats, and dive mutations.
  - Implement `useProfileStore`: encapsulates diver profile, dive sites, buddies, guides, and license management.
  - Implement `useEquipmentStore`: encapsulates gear inventory and service intervals.
  - Implement `useSettingsModals`: encapsulates modal state for create/remove dialogs.
- [x] **3.2 Decompose `Settings.vue`**
  - Refactor each settings tab (`DiveSitesTab.vue`, `BuddiesTab.vue`, `BackupTab.vue`, etc.) to consume `useProfileStore` and modals directly.
  - Remove `provide() { return { settingsContext: this } }` and reduce `Settings.vue` from 2,371 lines to 257 lines.
- [x] **3.3 Slim Down `AppRouteController.vue`**
  - Strip direct state management and API orchestration out of `AppRouteController.vue` into domain stores.
  - Reduced `AppRouteController.vue` from ~1,550 lines to ~750 lines.
- [x] **3.4 Verification**
  - All 18 Playwright end-to-end tests pass across Chromium.
  - Full frontend code checks pass (`check:structure`, `check:contracts`, ESLint, Prettier).
  - Backend unit test suite passes (100%).

---

### Phase 4: Backend Refinements & Future Features
*Goal: Leverage relational capabilities, fast aggregates, and robust synchronization.*

- [x] **4.1 SQL Statistics Aggregation (Phase 4A)**
  - Create a dedicated database query using PostgreSQL aggregates (`COUNT(*)`, `SUM(duration_seconds)`, `MAX(max_depth_m)`, `AVG(max_depth_m)`) rather than loading and summing dives in Go memory.
  - Implement `GetDiverStats(ctx, userID)` in `backend/internal/store/domain.go` to compute lifetime dashboard totals accurately across paginated lists.
- [x] **4.2 Native Nuxt Page Routing & Shell Modernization (Phase 4B)**
  - Fully eliminate simulated router monolith (`AppRouteController.vue` & `NuxtRouteShell.vue`).
  - Introduce native Nuxt 4 `app/pages/` hierarchy for all routes and `app/layouts/default.vue` application shell.
  - Extract reusable composables `useAppShell` and `useAppNavigation` with backward-compatible global hash redirect middleware.
  - 100% verified across Chromium, Firefox, and WebKit (54/54 tests passing).
- [ ] **4.3 Standardized API Errors**
  - Introduce structured error payloads (`{ "error": { "code": "...", "message": "..." } }`) across all endpoints.
- [ ] **4.4 Importer Robustness**
  - Standardize timezone handling and deduplication hashing across Subsurface XML and CSV imports.
- [ ] **4.5 Relational Schema Modeling & Logbook Normalization (Phase 4C)**
  - Relational foreign keys for dive sites and join table for buddies.

