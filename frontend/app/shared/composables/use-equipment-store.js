import { computed, reactive } from "vue";
import { createApiClient, requireJson } from "~/shared/api/client.js";
import {
  fetchEquipment as fetchEquipmentRequest,
  markEquipmentServiced as markEquipmentServicedRequest,
  saveEquipment as saveEquipmentRequest
} from "~/shared/api/equipment.js";
import { useAuth } from "~/shared/composables/auth.js";

const state = reactive({
  loaded: false,
  loading: false,
  saving: false,
  servicingId: null,
  equipment: [],
  error: "",
  statusMessage: ""
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

async function fetchEquipment(apiClient = null) {
  state.loading = true;
  state.error = "";
  try {
    const client = resolveApiClient(apiClient);
    const response = await fetchEquipmentRequest(client);
    const payload = await requireJson(response);
    state.equipment = Array.isArray(payload?.equipment) ? payload.equipment : [];
    state.loaded = true;
    return state.equipment;
  } catch (err) {
    state.equipment = [];
    state.error = err?.message || "Unable to load equipment.";
    throw err;
  } finally {
    state.loading = false;
  }
}

async function saveEquipment(items, apiClient = null) {
  state.saving = true;
  state.error = "";
  state.statusMessage = "";
  try {
    const client = resolveApiClient(apiClient);
    const response = await saveEquipmentRequest(client, items);
    const payload = await requireJson(response);
    state.equipment = Array.isArray(payload?.equipment) ? payload.equipment : [];
    state.statusMessage = "Equipment inventory saved.";
    return state.equipment;
  } catch (err) {
    state.error = err?.message || "Unable to save equipment.";
    return false;
  } finally {
    state.saving = false;
  }
}

async function markServiced(equipmentId, apiClient = null) {
  const id = String(equipmentId);
  state.servicingId = id;
  state.error = "";
  state.statusMessage = "";
  try {
    const client = resolveApiClient(apiClient);
    const response = await markEquipmentServicedRequest(client, equipmentId);
    const payload = await requireJson(response);
    const updated = payload?.equipment;
    if (updated?.id) {
      state.equipment = state.equipment.map((item) => (String(item.id) === String(updated.id) ? updated : item));
    } else {
      await fetchEquipment(client);
    }
    state.statusMessage = "Equipment marked as serviced.";
    return true;
  } catch (err) {
    state.error = err?.message || "Could not mark equipment as serviced.";
    return false;
  } finally {
    state.servicingId = null;
  }
}

function clearStatus() {
  state.statusMessage = "";
  state.error = "";
}

function resetState() {
  state.equipment = [];
  state.loaded = false;
  state.loading = false;
  state.saving = false;
  state.servicingId = null;
  state.error = "";
  state.statusMessage = "";
}

export function useEquipmentStore() {
  return reactive({
    state,
    equipment: computed(() => state.equipment),
    defaultEquipmentIds: computed(() => state.equipment.filter((item) => Boolean(item?.is_default)).map((item) => String(item.id))),
    totalEquipmentCount: computed(() => state.equipment.length),
    isLoading: computed(() => state.loading),
    isSaving: computed(() => state.saving),
    isLoaded: computed(() => state.loaded),
    servicingId: computed(() => state.servicingId),
    error: computed(() => state.error),
    statusMessage: computed(() => state.statusMessage),
    fetchEquipment,
    saveEquipment,
    markServiced,
    clearStatus,
    resetState
  });
}
