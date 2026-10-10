import { computed, reactive, unref } from "vue";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { emptyBuddy, emptyDiveSite, emptyGuide, emptyLicense } from "~/shared/utils/settings-profile.js";

const state = reactive({
  pendingCreation: null,
  pendingRemoval: null
});

export function useSettingsModals() {
  const profileStore = useProfileStore();

  function openCreateModal(type) {
    const draftByType = {
      license: emptyLicense,
      "dive-site": emptyDiveSite,
      buddy: emptyBuddy,
      guide: emptyGuide
    };
    const createDraft = draftByType[type];
    if (!createDraft) return;
    state.pendingCreation = {
      type,
      draft: createDraft(),
      error: "",
      submitting: false,
      lookupLoading: false
    };
  }

  function closeCreateModal() {
    if (state.pendingCreation?.submitting) return;
    state.pendingCreation = null;
  }

  function validatePendingCreation() {
    const creation = state.pendingCreation;
    if (!creation || !creation.draft) return "Nothing to save.";
    const { type, draft } = creation;
    if (type === "license" && !draft.company?.trim() && !draft.certification_name?.trim()) {
      return "Add a company or certification name before saving the license.";
    }
    if (type === "dive-site" && !draft.name?.trim()) {
      return "Enter a site name before saving the dive site.";
    }
    if (type === "buddy" && !draft.name?.trim()) {
      return "Enter a buddy name before saving the buddy.";
    }
    if (type === "guide" && !draft.name?.trim()) {
      return "Enter a guide name before saving the guide.";
    }
    return "";
  }

  async function searchPendingDiveSiteLocation() {
    const creation = state.pendingCreation;
    if (!creation || creation.type !== "dive-site") return;
    const site = creation.draft;
    const query = typeof site.location === "string" ? site.location.trim() : "";
    if (!query) {
      creation.error = "Enter a location before searching for GPS coordinates.";
      return;
    }

    creation.lookupLoading = true;
    creation.error = "";
    try {
      const payload = await profileStore.searchLocation(query);
      if (!payload?.found || !payload?.result) {
        creation.error = `No coordinates found for "${query}".`;
        return;
      }
      creation.draft = {
        ...site,
        country: typeof payload.result.country === "string" ? payload.result.country : site.country,
        latitude: String(payload.result.latitude),
        longitude: String(payload.result.longitude)
      };
    } catch (err) {
      creation.error = err?.message || "Could not search for GPS coordinates.";
    } finally {
      creation.lookupLoading = false;
    }
  }

  async function confirmCreateModal(apiClient = null) {
    const error = validatePendingCreation();
    if (error) {
      if (state.pendingCreation) {
        state.pendingCreation.error = error;
      }
      return false;
    }

    const creation = state.pendingCreation;
    if (!creation) return false;
    const { type, draft } = creation;

    creation.submitting = true;
    creation.error = "";

    try {
      if (type === "license") {
        const currentList = unref(profileStore.licenses) || [];
        const nextList = [draft, ...currentList];
        await profileStore.saveLicenses(nextList, apiClient);
      } else if (type === "dive-site") {
        const currentList = unref(profileStore.diveSites) || [];
        const nextList = [draft, ...currentList];
        await profileStore.saveDiveSites(nextList, apiClient);
      } else if (type === "buddy") {
        const currentList = unref(profileStore.buddies) || [];
        const nextList = [draft, ...currentList];
        await profileStore.saveBuddies(nextList, apiClient);
      } else if (type === "guide") {
        const currentList = unref(profileStore.guides) || [];
        const nextList = [draft, ...currentList];
        await profileStore.saveGuides(nextList, apiClient);
      }
      state.pendingCreation = null;
      return true;
    } catch (err) {
      if (state.pendingCreation) {
        state.pendingCreation.error = err?.message || "Could not save entry.";
      }
      return false;
    } finally {
      if (state.pendingCreation) {
        state.pendingCreation.submitting = false;
      }
    }
  }

  function openRemovalModal({ type, id, label, onConfirm }) {
    state.pendingRemoval = {
      type,
      id,
      label,
      onConfirm
    };
  }

  function closeRemovalModal() {
    state.pendingRemoval = null;
  }

  async function confirmRemoval() {
    const removal = state.pendingRemoval;
    if (!removal) return;
    try {
      if (typeof removal.onConfirm === "function") {
        await removal.onConfirm();
      }
    } finally {
      state.pendingRemoval = null;
    }
  }

  const pendingCreationTitle = computed(() => {
    const titleByType = {
      license: "Add License",
      "dive-site": "Add Dive Site",
      buddy: "Add Buddy",
      guide: "Add Guide"
    };
    return titleByType[state.pendingCreation?.type] || "Add Item";
  });

  const pendingCreationSubmitLabel = computed(() => {
    const labelByType = {
      license: "Save License",
      "dive-site": "Save Dive Site",
      buddy: "Save Buddy",
      guide: "Save Guide"
    };
    return labelByType[state.pendingCreation?.type] || "Save";
  });

  return reactive({
    state,
    pendingCreation: computed(() => state.pendingCreation),
    pendingCreationDraft: computed(() => state.pendingCreation?.draft || null),
    pendingCreationType: computed(() => state.pendingCreation?.type || null),
    pendingCreationError: computed(() => state.pendingCreation?.error || ""),
    pendingCreationSubmitting: computed(() => Boolean(state.pendingCreation?.submitting)),
    pendingCreationLookupLoading: computed(() => Boolean(state.pendingCreation?.lookupLoading)),
    pendingCreationTitle,
    pendingCreationSubmitLabel,
    pendingRemoval: computed(() => state.pendingRemoval),
    openCreateModal,
    closeCreateModal,
    searchPendingDiveSiteLocation,
    confirmCreateModal,
    openRemovalModal,
    closeRemovalModal,
    confirmRemoval
  });
}
