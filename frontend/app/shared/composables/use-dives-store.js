import { computed, reactive } from "vue";
import { createApiClient } from "~/shared/api/client.js";
import {
  createDive,
  deleteDive as deleteDiveRequest,
  fetchDive as fetchDiveRequest,
  fetchDives as fetchDivesRequest,
  updateDiveLogbook
} from "~/shared/api/dives.js";
import { fetchHealth } from "~/shared/api/profile.js";
import { uploadCsv, uploadSubsurface } from "~/shared/api/imports.js";
import { useAuth } from "~/shared/composables/auth.js";
import {
  effectiveImportDraft,
  importDraftSeed,
  isCommittedDive,
  isImportComplete,
  missingImportFields,
  paddedDiveIndex,
  pressureRange
} from "~/shared/utils/core.js";
import { createManualDiveDraft } from "~/shared/utils/dive-drafts.js";

function summarizeDivesFallback(dives = []) {
  const targetDives = dives.filter((dive) => isCommittedDive(dive));
  const divesToUse = targetDives.length ? targetDives : dives;
  const totalDives = divesToUse.length;
  let totalSeconds = 0;
  let maxDepth = 0;
  let totalBarConsumed = 0;
  let sumDepth = 0;

  for (const dive of divesToUse) {
    const sec = Number(dive?.duration_seconds || (dive?.duration_ms ? dive.duration_ms / 1000 : 0)) || 0;
    if (sec > 0) totalSeconds += sec;
    const depth = Number(dive?.max_depth_m || 0);
    if (depth > maxDepth) maxDepth = depth;
    sumDepth += depth;

    const range = pressureRange(dive);
    if (typeof range?.begin === "number" && typeof range?.end === "number") {
      const consumed = Math.round(range.begin - range.end);
      if (consumed > 0) totalBarConsumed += consumed;
    }
  }

  const totalHours = totalSeconds ? Math.round((totalSeconds / 3600) * 10) / 10 : 0;
  const averageDurationSeconds = totalDives ? Math.round((totalSeconds / totalDives) * 100) / 100 : 0;
  const averageMaxDepth = totalDives ? Math.round((sumDepth / totalDives) * 100) / 100 : 0;

  return {
    totalDives,
    totalSeconds,
    totalHours,
    maxDepth,
    totalBarConsumed,
    averageDurationSeconds,
    averageMaxDepth,
    bottomTimeProgress: Math.min(100, Math.round(totalHours))
  };
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  const hash = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((entry) => entry.toString(16).padStart(2, "0"))
    .join("");
}

const state = reactive({
  loaded: false,
  loading: false,
  error: "",
  backendHealthy: false,
  dives: [],
  diveDetails: {},
  dashboardStats: {
    totalDives: 0,
    totalSeconds: 0,
    totalHours: 0,
    maxDepth: 0,
    totalBarConsumed: 0,
    averageDurationSeconds: 0,
    averageMaxDepth: 0,
    bottomTimeProgress: 0
  },
  importDrafts: {},
  selectedDiveId: null,
  selectedImportId: null,
  selectedEditDiveId: null,
  searchText: "",
  savingImportId: null,
  bulkImportSavePending: false,
  deletingDiveId: null,
  importStatusMessage: "",
  importError: "",
  manualDiveDraft: createManualDiveDraft(),
  manualDiveCreating: false,
  manualDiveError: ""
});

function resolveApiClient(api) {
  if (api) return api;
  const { getToken, signOut } = useAuth();
  return createApiClient({
    getToken,
    onUnauthorized: () => {
      signOut();
    }
  });
}

function syncImportDrafts() {
  const nextDrafts = { ...state.importDrafts };
  state.dives.forEach((dive) => {
    const diveId = String(dive.id);
    if (!nextDrafts[diveId]) {
      nextDrafts[diveId] = importDraftSeed(dive);
    }
  });
  state.importDrafts = nextDrafts;
}

function resolvePendingImportId(dives = state.dives, drafts = state.importDrafts, preferredId = null) {
  const pending = dives.filter((dive) => !isImportComplete(effectiveImportDraft(dive, drafts[String(dive.id)])));
  if (preferredId && pending.some((dive) => String(dive.id) === String(preferredId))) {
    return preferredId;
  }
  return pending[0]?.id || null;
}

function isPendingImportId(diveId, dives = state.dives, drafts = state.importDrafts) {
  return dives.some((dive) => String(dive.id) === String(diveId) && !isImportComplete(effectiveImportDraft(dive, drafts[String(dive.id)])));
}

async function fetchDives(apiClient = null, options = {}) {
  const isSilent = options.silent === true;
  if (!isSilent) {
    state.loading = true;
  }
  state.error = "";
  try {
    const client = resolveApiClient(apiClient);
    const healthResponse = await fetchHealth(client).catch(() => ({ ok: false }));
    state.backendHealthy = healthResponse.ok;

    const query = options.query || "limit=250&include_samples=0";
    const diveResponse = await fetchDivesRequest(client, query);
    const payload = await diveResponse.json().catch(() => null);
    if (!diveResponse.ok) {
      throw new Error(payload?.error || `API returned ${diveResponse.status}`);
    }

    state.dives = Array.isArray(payload.dives) ? payload.dives : [];
    const apiStats = payload?.stats && typeof payload.stats === "object" ? payload.stats : null;
    if (apiStats && typeof apiStats.totalSeconds === "number") {
      state.dashboardStats = { ...state.dashboardStats, ...apiStats };
    } else {
      state.dashboardStats = { ...state.dashboardStats, ...summarizeDivesFallback(state.dives) };
    }

    syncImportDrafts();
    state.loaded = true;
    return state.dives;
  } catch (err) {
    state.error = err?.message || "Could not load dives.";
    throw err;
  } finally {
    if (!isSilent) {
      state.loading = false;
    }
  }
}

async function fetchDiveDetail(diveId, apiClient = null) {
  if (!diveId) return null;
  const id = String(diveId);
  const client = resolveApiClient(apiClient);

  try {
    const response = await fetchDiveRequest(client, id, "include_samples=1");
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `API returned ${response.status}`);
    }
    const dive = payload?.dive || payload;
    if (dive) {
      state.diveDetails[id] = dive;
      const target = state.dives.find((d) => String(d.id) === id);
      if (target) {
        if (Array.isArray(dive.samples)) target.samples = dive.samples;
        if (dive.fields) target.fields = dive.fields;
        if (typeof dive.sample_count === "number") target.sample_count = dive.sample_count;
      } else if (state.dives.length > 0) {
        state.dives.push(dive);
      }
    }
    return dive;
  } catch (err) {
    console.warn(`Could not load dive detail for ${id}:`, err);
    return null;
  }
}

function updateManualDiveDraft(key, value) {
  state.manualDiveDraft = {
    ...state.manualDiveDraft,
    [key]: value
  };
  state.manualDiveError = "";
}

async function createManualDive({ requiredLogbookFields = ["site"], equipmentSelectionEnabled = true, apiClient = null } = {}) {
  const draft = state.manualDiveDraft;
  const site = String(draft.site || "").trim();
  const buddy = String(draft.buddy || "").trim();
  const guide = String(draft.guide || "").trim();
  const weatherDescription = String(draft.weatherDescription || "").trim();
  const visibility = String(draft.visibility || "").trim();
  const wetsuitDescription = String(draft.wetsuitDescription || "").trim();
  const weightDescription = String(draft.weightDescription || "").trim();
  const notes = String(draft.notes || "").trim();
  const selectedEquipmentIds = Array.isArray(draft.equipment_ids) ? draft.equipment_ids.map(String) : [];
  const equipmentIds = equipmentSelectionEnabled ? selectedEquipmentIds : [];
  const durationMinutes = Number.parseFloat(draft.durationMinutes);
  const maxDepthM = Number.parseFloat(draft.maxDepthM);
  const temperatureInput = String(draft.temperatureC || "").trim();
  const tankVolumeInput = String(draft.tankVolumeL || "").trim();
  const beginPressureInput = String(draft.beginPressureBar || "").trim();
  const endPressureInput = String(draft.endPressureBar || "").trim();
  const temperatureC = temperatureInput === "" ? null : Number.parseFloat(temperatureInput);
  const tankVolume = tankVolumeInput === "" ? null : Number.parseFloat(tankVolumeInput);
  const beginPressure = beginPressureInput === "" ? null : Number.parseFloat(beginPressureInput);
  const endPressure = endPressureInput === "" ? null : Number.parseFloat(endPressureInput);

  const missingRequired = missingImportFields(
    {
      site,
      buddy,
      guide,
      weather_description: weatherDescription,
      visibility,
      wetsuit_description: wetsuitDescription,
      weight_description: weightDescription,
      notes
    },
    requiredLogbookFields
  );
  if (missingRequired.length) {
    state.manualDiveError = `${missingRequired[0].label} is required for manual entries.`;
    return null;
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    state.manualDiveError = "Duration must be greater than zero.";
    return null;
  }
  if (!Number.isFinite(maxDepthM) || maxDepthM < 0) {
    state.manualDiveError = "Max depth must be zero or greater.";
    return null;
  }
  if (temperatureInput && !Number.isFinite(temperatureC)) {
    state.manualDiveError = "Temperature must be a valid number.";
    return null;
  }
  if (tankVolumeInput && (!Number.isFinite(tankVolume) || tankVolume <= 0)) {
    state.manualDiveError = "Tank volume must be greater than zero.";
    return null;
  }
  if (beginPressureInput && (!Number.isFinite(beginPressure) || beginPressure < 0 || beginPressure > 400)) {
    state.manualDiveError = "Entry tank pressure must be between 0 and 400 bar.";
    return null;
  }
  if (endPressureInput && (!Number.isFinite(endPressure) || endPressure < 0 || endPressure > 400)) {
    state.manualDiveError = "Exit tank pressure must be between 0 and 400 bar.";
    return null;
  }
  if (beginPressure !== null && endPressure !== null && endPressure > beginPressure) {
    state.manualDiveError = "Exit tank pressure cannot be higher than entry tank pressure.";
    return null;
  }

  const date = String(draft.date || "").trim();
  const time = String(draft.time || "").trim();
  if (!date || !time) {
    state.manualDiveError = "Manual dives require a valid local start date and time.";
    return null;
  }
  const startedAtDate = new Date(`${date}T${time}`);
  if (Number.isNaN(startedAtDate.getTime())) {
    state.manualDiveError = "Manual dives require a valid local start date and time.";
    return null;
  }
  const startedAt = startedAtDate.toISOString();
  const completedAt = new Date().toISOString();
  const rawSource = JSON.stringify({
    source: "manual",
    created_at: completedAt,
    started_at: startedAt,
    duration_seconds: Math.round(durationMinutes * 60),
    max_depth_m: maxDepthM,
    site,
    buddy,
    guide
  });

  const rawDataB64 = encodeBase64Utf8(rawSource);
  const rawSha256 = await sha256Hex(rawSource);
  const fields = {
    manual_entry: true,
    source: "manual",
    logbook: {
      site,
      buddy,
      guide,
      weather_description: weatherDescription,
      visibility,
      wetsuit_description: wetsuitDescription,
      weight_description: weightDescription,
      notes,
      equipment_ids: equipmentIds,
      status: "complete",
      completed_at: completedAt
    }
  };

  if (Number.isFinite(temperatureC)) {
    fields.temperature_surface_c = temperatureC;
    fields.temperature_minimum_c = temperatureC;
    fields.temperature_maximum_c = temperatureC;
  }

  if (Number.isFinite(tankVolume) || Number.isFinite(beginPressure) || Number.isFinite(endPressure)) {
    const tank = {};
    if (Number.isFinite(tankVolume)) tank.volume = tankVolume;
    if (Number.isFinite(beginPressure)) tank.beginpressure_bar = Math.round(beginPressure);
    if (Number.isFinite(endPressure)) tank.endpressure_bar = Math.round(endPressure);
    fields.tanks = [tank];
  }

  state.manualDiveCreating = true;
  state.manualDiveError = "";
  try {
    const client = resolveApiClient(apiClient);
    const response = await createDive(client, {
      vendor: "Manual",
      product: "Entry",
      dive_uid: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      raw_sha256: rawSha256,
      raw_data_b64: rawDataB64,
      started_at: startedAt,
      duration_seconds: Math.round(durationMinutes * 60),
      max_depth_m: maxDepthM,
      avg_depth_m: null,
      fields,
      samples: []
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `API returned ${response.status}`);
    }

    await fetchDives(client);
    state.manualDiveDraft = createManualDiveDraft();
    state.importStatusMessage = "Manual dive created.";
    return payload;
  } catch (error) {
    state.manualDiveError = error?.message || "Unable to create manual dive.";
    return null;
  } finally {
    state.manualDiveCreating = false;
  }
}

async function uploadCsvImport(file, options = {}, apiClient = null) {
  if (!file) return false;
  const dryRun = options.dryRun === true;
  const setImportFeedback = options.setImportFeedback !== false;
  if (setImportFeedback) {
    state.importError = "";
    state.importStatusMessage = "";
  }
  const refreshAfterImport = options.refreshDives !== false;
  try {
    const client = resolveApiClient(apiClient);
    const csvText = await file.text();
    const response = await uploadCsv(client, new Blob([csvText], { type: "text/csv; charset=utf-8" }), {
      dryRun,
      timeoutMs: 30000
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `API returned ${response.status}`);
    }
    if (!dryRun && refreshAfterImport) {
      await fetchDives(client);
    }
    if (!dryRun && setImportFeedback) {
      state.importStatusMessage = `CSV import processed ${payload.rows || 0} row(s): ${payload.inserted || 0} new, ${payload.duplicates || 0} duplicate.`;
    }
    return payload;
  } catch (error) {
    if (setImportFeedback) {
      state.importError = error?.message || "Unable to import CSV file.";
    }
    throw error;
  }
}

async function uploadSubsurfaceImport(file, options = {}, apiClient = null) {
  if (!file) return false;
  const dryRun = options.dryRun === true;
  const refreshAfterImport = options.refreshDives !== false;
  const client = resolveApiClient(apiClient);
  const response = await uploadSubsurface(client, file, { dryRun, timeoutMs: 30000 });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `API returned ${response.status}`);
  }
  if (!dryRun && refreshAfterImport) {
    await fetchDives(client);
  }
  return payload;
}

async function persistLogbookUpdate(diveId, draft, commit = false, apiClient = null) {
  const client = resolveApiClient(apiClient);
  const id = String(diveId);

  const beginPressureInput = String(draft.begin_pressure_bar || "").trim();
  const endPressureInput = String(draft.end_pressure_bar || "").trim();
  const beginPressure = beginPressureInput === "" ? null : Number.parseFloat(beginPressureInput);
  const endPressure = endPressureInput === "" ? null : Number.parseFloat(endPressureInput);

  if (beginPressureInput && (!Number.isFinite(beginPressure) || beginPressure < 0 || beginPressure > 400)) {
    throw new Error("Entry tank pressure must be between 0 and 400 bar.");
  }
  if (endPressureInput && (!Number.isFinite(endPressure) || endPressure < 0 || endPressure > 400)) {
    throw new Error("Exit tank pressure must be between 0 and 400 bar.");
  }
  if (beginPressure !== null && endPressure !== null && endPressure > beginPressure) {
    throw new Error("Exit tank pressure cannot be higher than entry tank pressure.");
  }

  const response = await updateDiveLogbook(client, diveId, {
    commit,
    tank_volume_l: draft.tank_volume_l || null,
    begin_pressure_bar: beginPressure,
    end_pressure_bar: endPressure,
    logbook: {
      site: draft.site,
      buddy: draft.buddy,
      guide: draft.guide,
      weather_description: draft.weather_description,
      visibility: draft.visibility,
      wetsuit_description: draft.wetsuit_description,
      weight_description: draft.weight_description,
      notes: draft.notes,
      equipment_ids: Array.isArray(draft.equipment_ids) ? draft.equipment_ids : [],
      status: commit ? "complete" : "imported"
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `API returned ${response.status}`);
  }

  const updatedDive = payload?.dive || payload;
  state.dives = state.dives.map((entry) => (String(entry.id) === id ? updatedDive : entry));
  state.diveDetails[id] = updatedDive;
  state.importDrafts[id] = importDraftSeed(updatedDive);
  state.dashboardStats = { ...state.dashboardStats, ...summarizeDivesFallback(state.dives) };

  return updatedDive;
}

async function saveImportDraft(diveId, commit = false, requiredFields = ["site"], apiClient = null) {
  const id = String(diveId);
  const dive = state.dives.find((entry) => String(entry.id) === id);
  if (!dive) {
    state.importError = "Dive could not be found for metadata update.";
    return false;
  }

  const wasCommitted = isCommittedDive(dive);
  const draft = effectiveImportDraft(dive, state.importDrafts[id]);
  const missing = missingImportFields(draft, requiredFields);
  if ((commit || wasCommitted) && missing.length) {
    state.importError = `${missing[0].label} is required before completing this record.`;
    return false;
  }

  state.savingImportId = id;
  state.importError = "";
  state.importStatusMessage = "";

  try {
    const shouldCommit = commit || wasCommitted;
    const updatedDive = await persistLogbookUpdate(diveId, draft, shouldCommit, apiClient);
    state.importStatusMessage =
      shouldCommit && !wasCommitted
        ? `${paddedDiveIndex(updatedDive, state.dives)} committed to the registry.`
        : wasCommitted
          ? `${paddedDiveIndex(updatedDive, state.dives)} metadata updated.`
          : `Draft saved for ${paddedDiveIndex(updatedDive)}.`;
    return updatedDive;
  } catch (err) {
    state.importError = err?.message || "Unable to save import metadata.";
    return false;
  } finally {
    state.savingImportId = null;
  }
}

async function deleteDive(diveId, apiClient = null) {
  const id = String(diveId);
  const dive = state.dives.find((entry) => String(entry.id) === id);
  if (!dive) {
    state.importError = "Dive could not be found for deletion.";
    return false;
  }

  state.deletingDiveId = id;
  state.importError = "";
  state.importStatusMessage = "";

  try {
    const client = resolveApiClient(apiClient);
    const response = await deleteDiveRequest(client, id);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `API returned ${response.status}`);
    }

    const wasImported = !isCommittedDive(dive);
    state.dives = state.dives.filter((entry) => String(entry.id) !== id);
    delete state.diveDetails[id];
    delete state.importDrafts[id];

    if (String(state.selectedDiveId) === id) state.selectedDiveId = null;
    if (String(state.selectedImportId) === id) state.selectedImportId = null;
    if (String(state.selectedEditDiveId) === id) state.selectedEditDiveId = null;

    state.dashboardStats = { ...state.dashboardStats, ...summarizeDivesFallback(state.dives) };
    state.importStatusMessage = `${paddedDiveIndex(dive, state.dives)} removed from the ${wasImported ? "import queue" : "dive log"}.`;
    return true;
  } catch (err) {
    state.importError = err?.message || "Could not delete dive.";
    return false;
  } finally {
    state.deletingDiveId = null;
  }
}

async function applyBuddyGuideToPending(diveId, apiClient = null) {
  const id = String(diveId);
  const sourceDive = state.dives.find((entry) => String(entry.id) === id);
  if (!sourceDive) {
    state.importError = "Dive could not be found for bulk metadata update.";
    return false;
  }

  const sourceDraft = effectiveImportDraft(sourceDive, state.importDrafts[id]);
  const updates = {};
  if (typeof sourceDraft.buddy === "string" && sourceDraft.buddy.trim()) {
    updates.buddy = sourceDraft.buddy;
  }
  if (typeof sourceDraft.guide === "string" && sourceDraft.guide.trim()) {
    updates.guide = sourceDraft.guide;
  }

  const updateKeys = Object.keys(updates);
  if (!updateKeys.length) {
    state.importError = "Enter a buddy or guide before applying the values across imported dives.";
    state.importStatusMessage = "";
    return false;
  }

  const pendingDives = state.dives.filter((entry) => !isImportComplete(effectiveImportDraft(entry, state.importDrafts[String(entry.id)])));
  if (!pendingDives.length) {
    state.importError = "There are no imported dives waiting for metadata updates.";
    state.importStatusMessage = "";
    return false;
  }

  state.bulkImportSavePending = true;
  state.importError = "";
  state.importStatusMessage = "";

  let updatedCount = 0;
  try {
    for (const pendingDive of pendingDives) {
      const pendingId = String(pendingDive.id);
      const currentDraft = effectiveImportDraft(pendingDive, state.importDrafts[pendingId]);
      await persistLogbookUpdate(
        pendingDive.id,
        {
          ...currentDraft,
          ...updates,
          status: "imported"
        },
        false,
        apiClient
      );
      updatedCount += 1;
    }

    const appliedLabel = updateKeys.length === 2 ? "buddy and guide" : updateKeys[0];
    state.importStatusMessage = `Applied ${appliedLabel} to ${updatedCount} imported ${updatedCount === 1 ? "dive" : "dives"}. Dive sites were left unchanged.`;
    return true;
  } catch (err) {
    state.importError = err?.message || "Unable to apply buddy and guide across imported dives.";
    return false;
  } finally {
    state.bulkImportSavePending = false;
  }
}

function updateImportDraftField(diveId, field, value) {
  const id = String(diveId);
  const dive = state.dives.find((d) => String(d.id) === id);
  const currentDraft = effectiveImportDraft(dive, state.importDrafts[id]);
  state.importDrafts[id] = {
    ...currentDraft,
    [field]: value,
    status: "imported"
  };
  state.importStatusMessage = "";
  state.importError = "";
}

function resetState() {
  state.loaded = false;
  state.loading = false;
  state.error = "";
  state.backendHealthy = false;
  state.dives = [];
  state.diveDetails = {};
  state.dashboardStats = {
    totalDives: 0,
    totalSeconds: 0,
    totalHours: 0,
    maxDepth: 0,
    totalBarConsumed: 0,
    averageDurationSeconds: 0,
    averageMaxDepth: 0,
    bottomTimeProgress: 0
  };
  state.importDrafts = {};
  state.selectedDiveId = null;
  state.selectedImportId = null;
  state.selectedEditDiveId = null;
  state.searchText = "";
  state.savingImportId = null;
  state.bulkImportSavePending = false;
  state.deletingDiveId = null;
  state.importStatusMessage = "";
  state.importError = "";
  state.manualDiveDraft = createManualDiveDraft();
  state.manualDiveCreating = false;
  state.manualDiveError = "";
}

export function useDivesStore() {
  return reactive({
    state,
    dives: computed(() => state.dives),
    committedDives: computed(() => state.dives.filter((d) => isCommittedDive(d))),
    pendingImports: computed(() => state.dives.filter((d) => !isCommittedDive(d))),
    importedDiveCount: computed(() => state.dives.filter((d) => !isCommittedDive(d)).length),
    selectedDiveId: computed({
      get: () => state.selectedDiveId,
      set: (val) => {
        state.selectedDiveId = val;
      }
    }),
    selectedImportId: computed({
      get: () => state.selectedImportId,
      set: (val) => {
        state.selectedImportId = val;
      }
    }),
    selectedEditDiveId: computed({
      get: () => state.selectedEditDiveId,
      set: (val) => {
        state.selectedEditDiveId = val;
      }
    }),
    selectedDive: computed(() => {
      if (!state.selectedDiveId) return null;
      const id = String(state.selectedDiveId);
      return state.diveDetails[id] || state.dives.find((d) => String(d.id) === id) || null;
    }),
    selectedImportDive: computed(() => {
      if (!state.selectedImportId) return null;
      const id = String(state.selectedImportId);
      const d = state.dives.find((e) => String(e.id) === id);
      return d && !isCommittedDive(d) ? d : null;
    }),
    selectedEditDive: computed(() => {
      if (!state.selectedEditDiveId) return null;
      const id = String(state.selectedEditDiveId);
      const d = state.dives.find((e) => String(e.id) === id);
      return d && isCommittedDive(d) ? d : null;
    }),
    selectedImportDraft: computed(() => {
      if (!state.selectedImportId) return null;
      const id = String(state.selectedImportId);
      const d = state.dives.find((e) => String(e.id) === id);
      return d ? effectiveImportDraft(d, state.importDrafts[id]) : null;
    }),
    selectedEditDraft: computed(() => {
      if (!state.selectedEditDiveId) return null;
      const id = String(state.selectedEditDiveId);
      const d = state.dives.find((e) => String(e.id) === id);
      return d ? effectiveImportDraft(d, state.importDrafts[id]) : null;
    }),
    dashboardStats: computed(() => state.dashboardStats),
    stats: computed(() =>
      state.dashboardStats && typeof state.dashboardStats.totalSeconds === "number"
        ? state.dashboardStats
        : summarizeDivesFallback(state.dives)
    ),
    searchText: computed({
      get: () => state.searchText,
      set: (val) => {
        state.searchText = val;
      }
    }),
    importDrafts: computed(() => state.importDrafts),
    isLoading: computed(() => state.loading),
    isLoaded: computed(() => state.loaded),
    backendHealthy: computed(() => state.backendHealthy),
    error: computed(() => state.error),
    savingImportId: computed(() => state.savingImportId),
    bulkImportSavePending: computed(() => state.bulkImportSavePending),
    deletingDiveId: computed(() => state.deletingDiveId),
    importStatusMessage: computed(() => state.importStatusMessage),
    importError: computed(() => state.importError),
    manualDiveDraft: computed(() => state.manualDiveDraft),
    manualDiveCreating: computed(() => state.manualDiveCreating),
    manualDiveError: computed(() => state.manualDiveError),
    fetchDives,
    fetchDiveDetail,
    createManualDive,
    updateManualDiveDraft,
    saveImportDraft,
    deleteDive,
    applyBuddyGuideToPending,
    updateImportDraftField,
    uploadCsvImport,
    uploadSubsurfaceImport,
    resolvePendingImportId,
    isPendingImportId,
    syncImportDrafts,
    resetState
  });
}
