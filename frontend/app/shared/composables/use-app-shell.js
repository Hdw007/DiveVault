import { computed, reactive, ref } from "vue";
import { useRouter } from "#app";
import { useAuth, useUser } from "~/shared/composables/auth.js";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useEquipmentStore } from "~/shared/composables/use-equipment-store.js";
import { useAppPreferences } from "~/shared/composables/app-preferences.js";
import { createApiClient } from "~/shared/api/client.js";
import { updatePassword } from "~/shared/api/auth.js";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "~/config/runtime.js";
import { DEFAULT_SETTINGS_SECTION, SETTINGS_SECTION_IDS, encodePathSegment } from "~/routing/routes.js";
import { isCommittedDive, paddedDiveIndex } from "~/shared/utils/core.js";

// Global UI state shared across layout and views
const mobileAccountMenuOpen = ref(false);
const desktopAccountMenuOpen = ref(false);
const passwordDialogOpen = ref(false);
const passwordSubmitting = ref(false);
const passwordError = ref("");
const passwordStatus = ref("");
const passwordForm = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: ""
});

export function useAppShell() {
  const router = useRouter();
  const auth = useAuth();
  const { user } = useUser();
  const divesStore = useDivesStore();
  const profileStore = useProfileStore();
  const equipmentStore = useEquipmentStore();
  const preferences = useAppPreferences();

  function apiClient() {
    return createApiClient({
      getToken: auth.getToken,
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS
    });
  }

  const currentUserEmail = computed(() => {
    return user.value?.primaryEmailAddress?.emailAddress || user.value?.emailAddresses?.[0]?.emailAddress || "";
  });

  const currentUserName = computed(() => {
    const firstName = user.value?.firstName?.trim() || "";
    const lastName = user.value?.lastName?.trim() || "";
    return [firstName, lastName].filter(Boolean).join(" ") || currentUserEmail.value || "Diver";
  });

  const currentUserInitials = computed(() => {
    const source = currentUserName.value || "Diver";
    const initials = source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
    return initials || "DV";
  });

  const canManageUsers = computed(() => {
    return Boolean(user.value?.isOwner);
  });

  function normalizeSettingsSection(sectionId) {
    if (!SETTINGS_SECTION_IDS.has(sectionId)) {
      return DEFAULT_SETTINGS_SECTION;
    }
    if (sectionId === "manage-users" && !canManageUsers.value) {
      return DEFAULT_SETTINGS_SECTION;
    }
    return sectionId;
  }

  function toggleMobileAccountMenu() {
    mobileAccountMenuOpen.value = !mobileAccountMenuOpen.value;
  }

  function closeMobileAccountMenu() {
    mobileAccountMenuOpen.value = false;
  }

  function toggleDesktopAccountMenu() {
    desktopAccountMenuOpen.value = !desktopAccountMenuOpen.value;
  }

  function closeDesktopAccountMenu() {
    desktopAccountMenuOpen.value = false;
  }

  function closeAccountMenus() {
    mobileAccountMenuOpen.value = false;
    desktopAccountMenuOpen.value = false;
  }

  async function openMobileSettings() {
    closeAccountMenus();
    await router.push("/settings");
  }

  async function signOutUser() {
    closeAccountMenus();
    if (typeof auth.signOut === "function") {
      await auth.signOut({ redirectUrl: "/" });
    }
  }

  function openPasswordDialog() {
    closeAccountMenus();
    passwordDialogOpen.value = true;
    passwordError.value = "";
    passwordStatus.value = "";
    passwordForm.currentPassword = "";
    passwordForm.newPassword = "";
    passwordForm.confirmPassword = "";
  }

  function closePasswordDialog() {
    passwordDialogOpen.value = false;
    passwordSubmitting.value = false;
    passwordError.value = "";
    passwordStatus.value = "";
    passwordForm.currentPassword = "";
    passwordForm.newPassword = "";
    passwordForm.confirmPassword = "";
  }

  async function submitPasswordChange() {
    passwordSubmitting.value = true;
    passwordError.value = "";
    passwordStatus.value = "";
    const currentPassword = passwordForm.currentPassword;
    const newPassword = passwordForm.newPassword;
    const confirmPassword = passwordForm.confirmPassword;

    if (!currentPassword || !newPassword) {
      passwordError.value = "Current password and new password are required.";
      passwordSubmitting.value = false;
      return;
    }
    if (newPassword.length < 8) {
      passwordError.value = "New password must be at least 8 characters.";
      passwordSubmitting.value = false;
      return;
    }
    if (newPassword !== confirmPassword) {
      passwordError.value = "New password confirmation does not match.";
      passwordSubmitting.value = false;
      return;
    }

    try {
      const response = await updatePassword(apiClient(), {
        current_password: currentPassword,
        new_password: newPassword
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `API returned ${response.status}`);
      }
      passwordStatus.value = "Password updated.";
      window.setTimeout(() => {
        if (passwordDialogOpen.value) {
          closePasswordDialog();
        }
      }, 900);
    } catch (error) {
      passwordError.value = error?.message || "Could not update the password.";
    } finally {
      passwordSubmitting.value = false;
    }
  }

  async function bootstrapAppData() {
    const client = apiClient();
    await Promise.all([divesStore.fetchDives(client), profileStore.fetchProfile(client), equipmentStore.fetchEquipment(client)]);
  }

  function resetAuthenticatedState() {
    divesStore.resetState();
    profileStore.resetState();
    equipmentStore.resetState();
    closeAccountMenus();
    closePasswordDialog();
  }

  async function deleteDive(diveId) {
    const id = String(diveId);
    const dive = divesStore.dives.find((entry) => String(entry.id) === id);
    if (!dive) {
      divesStore.state.importError = "Dive could not be found for deletion.";
      divesStore.state.importStatusMessage = "";
      return false;
    }

    const importedRecord = !isCommittedDive(dive);
    const confirmed = window.confirm(
      importedRecord
        ? `Delete ${paddedDiveIndex(dive)} from the import queue? This cannot be undone.`
        : `Delete ${paddedDiveIndex(dive, divesStore.dives)} from the dive log? This cannot be undone.`
    );
    if (!confirmed) {
      return false;
    }

    const success = await divesStore.deleteDive(diveId, apiClient());
    if (success) {
      if (importedRecord) {
        await router.push("/imports");
      } else {
        await router.push("/logs");
      }
    }
    return success;
  }

  async function createManualDive() {
    const created = await divesStore.createManualDive({
      requiredLogbookFields: profileStore.requiredLogbookFields,
      equipmentSelectionEnabled: profileStore.equipmentSelectionEnabled,
      apiClient: apiClient()
    });
    if (created?.id) {
      await router.push(`/logs/${encodePathSegment(created.id)}`);
    } else if (!divesStore.manualDiveError) {
      await router.push("/logs");
    }
    return created;
  }

  async function saveImportDraft(diveId, commit = false) {
    const id = String(diveId);
    const dive = divesStore.dives.find((entry) => String(entry.id) === id);
    const wasCommitted = dive ? isCommittedDive(dive) : false;

    const updated = await divesStore.saveImportDraft(diveId, commit, profileStore.requiredLogbookFields, apiClient());
    if (!updated) {
      return false;
    }

    if ((commit || wasCommitted) && !wasCommitted) {
      const nextPendingId = divesStore.resolvePendingImportId(divesStore.dives, divesStore.importDrafts, null);
      await router.push(nextPendingId ? `/imports/${encodePathSegment(nextPendingId)}` : "/imports");
    }
    return true;
  }

  async function saveExistingDiveLogbook(diveId) {
    return saveImportDraft(diveId, true);
  }

  async function uploadCsvImport(file, options = {}) {
    const dryRun = options.dryRun === true;
    const navigateToQueue = options.navigateToQueue !== false;
    const payload = await divesStore.uploadCsvImport(file, options, apiClient());
    if (!dryRun && navigateToQueue) {
      const nextPendingId = divesStore.resolvePendingImportId(divesStore.dives, divesStore.importDrafts, null);
      await router.push(nextPendingId ? `/imports/${encodePathSegment(nextPendingId)}` : "/imports");
    }
    return payload;
  }

  return {
    apiClient,
    currentUserEmail,
    currentUserName,
    currentUserInitials,
    canManageUsers,
    normalizeSettingsSection,
    mobileAccountMenuOpen,
    desktopAccountMenuOpen,
    toggleMobileAccountMenu,
    closeMobileAccountMenu,
    toggleDesktopAccountMenu,
    closeDesktopAccountMenu,
    closeAccountMenus,
    openMobileSettings,
    signOutUser,
    passwordDialogOpen,
    passwordForm,
    passwordSubmitting,
    passwordError,
    passwordStatus,
    openPasswordDialog,
    closePasswordDialog,
    submitPasswordChange,
    bootstrapAppData,
    resetAuthenticatedState,
    deleteDive,
    createManualDive,
    saveImportDraft,
    saveExistingDiveLogbook,
    uploadCsvImport,
    preferences
  };
}
