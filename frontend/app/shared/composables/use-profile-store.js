import { computed, reactive } from "vue";
import { createApiClient } from "~/shared/api/client.js";
import { fetchProfile as fetchProfileRequest, searchGeocode, updateLicensePdf, updateProfile } from "~/shared/api/profile.js";
import { useAuth } from "~/shared/composables/auth.js";
import {
  bytesToBase64,
  cloneProfile,
  editableBuddyPayload,
  editableDiveSitePayload,
  editableGuidePayload,
  editableLicensePayload,
  emptyProfile
} from "~/shared/utils/settings-profile.js";

const state = reactive({
  loaded: false,
  loading: false,
  saving: false,
  error: "",
  statusMessage: "",
  profile: emptyProfile(),
  diveSiteLookupLoading: false,
  licenseUploadingId: null
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

function hydrateProfileState(payload = {}) {
  state.profile = cloneProfile(payload);
  state.loaded = true;
  return state.profile;
}

async function fetchProfile(apiClient = null) {
  state.loading = true;
  state.error = "";
  try {
    const client = resolveApiClient(apiClient);
    const response = await fetchProfileRequest(client);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `API returned ${response.status}`);
    }
    return hydrateProfileState(payload);
  } catch (err) {
    state.error = err?.message || "Could not load user profile.";
    throw err;
  } finally {
    state.loading = false;
  }
}

async function saveProfilePayload(payloadUpdates, apiClient = null) {
  state.saving = true;
  state.error = "";
  try {
    const client = resolveApiClient(apiClient);
    const response = await updateProfile(client, payloadUpdates);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `API returned ${response.status}`);
    }
    const hydrated = hydrateProfileState(payload);
    return hydrated;
  } catch (err) {
    state.error = err?.message || "Could not save user profile.";
    throw err;
  } finally {
    state.saving = false;
  }
}

async function saveProfileDetails(draft, apiClient = null) {
  const payload = {
    name: draft?.name || "",
    email: draft?.email || ""
  };
  const updated = await saveProfilePayload(payload, apiClient);
  state.statusMessage = "Profile updated.";
  return updated;
}

async function saveDiveSites(diveSites, apiClient = null) {
  const payload = {
    dive_sites: (diveSites || []).map(editableDiveSitePayload)
  };
  const updated = await saveProfilePayload(payload, apiClient);
  state.statusMessage = "Dive sites updated.";
  return updated;
}

async function saveBuddies(buddies, apiClient = null) {
  const payload = {
    buddies: (buddies || []).map(editableBuddyPayload)
  };
  const updated = await saveProfilePayload(payload, apiClient);
  state.statusMessage = "Buddies updated.";
  return updated;
}

async function saveGuides(guides, apiClient = null) {
  const payload = {
    guides: (guides || []).map(editableGuidePayload)
  };
  const updated = await saveProfilePayload(payload, apiClient);
  state.statusMessage = "Guides updated.";
  return updated;
}

async function saveLicenses(licenses, apiClient = null) {
  const payload = {
    licenses: (licenses || []).map(editableLicensePayload)
  };
  const updated = await saveProfilePayload(payload, apiClient);
  state.statusMessage = "Licenses updated.";
  return updated;
}

async function updatePublicSharing(enabled, apiClient = null) {
  const payload = {
    public_dives_enabled: Boolean(enabled)
  };
  const updated = await saveProfilePayload(payload, apiClient);
  state.statusMessage = updated?.public_dives_enabled ? "Public dive profile enabled." : "Public dive profile disabled.";
  return updated;
}

async function updateLogbookDisplayFields(fields, apiClient = null) {
  const payload = {
    logbook_display_fields: Array.isArray(fields) ? [...fields] : []
  };
  return saveProfilePayload(payload, apiClient);
}

async function updateRequiredLogbookFields(fields, apiClient = null) {
  const payload = {
    required_logbook_fields: Array.isArray(fields) ? [...fields] : ["site"]
  };
  return saveProfilePayload(payload, apiClient);
}

async function updateEquipmentSelectionEnabled(enabled, apiClient = null) {
  const payload = {
    equipment_selection_enabled: Boolean(enabled)
  };
  return saveProfilePayload(payload, apiClient);
}

async function uploadLicense(licenseId, fileOrPayload, apiClient = null) {
  state.licenseUploadingId = licenseId;
  state.error = "";
  try {
    const client = resolveApiClient(apiClient);
    let payload = fileOrPayload;
    if (typeof File !== "undefined" && fileOrPayload instanceof File) {
      const bytes = new Uint8Array(await fileOrPayload.arrayBuffer());
      payload = {
        filename: fileOrPayload.name,
        content_type: "application/pdf",
        data_b64: bytesToBase64(bytes)
      };
    }
    const response = await updateLicensePdf(client, licenseId, payload);
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || `API returned ${response.status}`);
    }
    const updated = hydrateProfileState(result);
    state.statusMessage = `${payload?.filename || "License document"} uploaded for the selected license.`;
    return updated;
  } catch (err) {
    state.error = err?.message || "Could not upload license document.";
    throw err;
  } finally {
    state.licenseUploadingId = null;
  }
}

async function searchLocation(query, apiClient = null) {
  state.diveSiteLookupLoading = true;
  state.error = "";
  try {
    const client = resolveApiClient(apiClient);
    const response = await searchGeocode(client, query);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `API returned ${response.status}`);
    }
    return payload;
  } catch (err) {
    state.error = err?.message || "Could not search location.";
    throw err;
  } finally {
    state.diveSiteLookupLoading = false;
  }
}

async function createDiveSite(sitePayload, apiClient = null) {
  const name = typeof sitePayload?.name === "string" ? sitePayload.name.trim() : "";
  if (!name) {
    throw new Error("Enter a dive site name before saving it.");
  }
  const currentSites = state.profile?.dive_sites || [];
  const existingSite = currentSites.find((site) => typeof site?.name === "string" && site.name.trim().toLowerCase() === name.toLowerCase());
  if (existingSite) {
    return existingSite;
  }
  const client = resolveApiClient(apiClient);
  const response = await updateProfile(client, {
    dive_sites: [
      ...currentSites,
      {
        name,
        location: typeof sitePayload?.location === "string" ? sitePayload.location.trim() : "",
        country: typeof sitePayload?.country === "string" ? sitePayload.country.trim() : "",
        latitude: sitePayload?.latitude ?? null,
        longitude: sitePayload?.longitude ?? null
      }
    ]
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `API returned ${response.status}`);
  }
  hydrateProfileState(payload);
  return (
    (state.profile?.dive_sites || []).find((s) => typeof s?.name === "string" && s.name.trim().toLowerCase() === name.toLowerCase()) || {
      name
    }
  );
}

function clearStatus() {
  state.statusMessage = "";
  state.error = "";
}

function resetState() {
  state.profile = emptyProfile();
  state.loaded = false;
  state.loading = false;
  state.saving = false;
  state.error = "";
  state.statusMessage = "";
  state.licenseUploadingId = null;
  state.diveSiteLookupLoading = false;
}

export function useProfileStore() {
  return reactive({
    state,
    profile: computed(() => state.profile),
    diveSites: computed(() => state.profile.dive_sites),
    buddies: computed(() => state.profile.buddies),
    guides: computed(() => state.profile.guides),
    licenses: computed(() => state.profile.licenses),
    logbookDisplayFields: computed(() => state.profile.logbook_display_fields),
    requiredLogbookFields: computed(() => state.profile.required_logbook_fields),
    equipmentSelectionEnabled: computed(() => state.profile.equipment_selection_enabled),
    isLoaded: computed(() => state.loaded),
    isLoading: computed(() => state.loading),
    isSaving: computed(() => state.saving),
    error: computed(() => state.error),
    statusMessage: computed(() => state.statusMessage),
    diveSiteLookupLoading: computed(() => state.diveSiteLookupLoading),
    licenseUploadingId: computed(() => state.licenseUploadingId),
    fetchProfile,
    saveProfileDetails,
    saveDiveSites,
    saveBuddies,
    saveGuides,
    saveLicenses,
    createDiveSite,
    updatePublicSharing,
    updateLogbookDisplayFields,
    updateRequiredLogbookFields,
    updateEquipmentSelectionEnabled,
    uploadLicense,
    searchLocation,
    hydrateProfileState,
    clearStatus,
    resetState
  });
}
