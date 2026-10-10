<script>
import { defineAsyncComponent } from "vue";
import { useRoute, useRouter } from "#app";
import { useAuth, useUser } from "~/shared/composables/auth.js";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useEquipmentStore } from "~/shared/composables/use-equipment-store.js";
import { filledIconStyle, isCommittedDive, paddedDiveIndex } from "~/shared/utils/core.js";
import { NAV_ITEMS } from "~/config/navigation.js";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "~/config/runtime.js";
import {
  currentRouteState as getCurrentRouteState,
  handleRouteNavigation as handleAppRouteNavigation,
  initializeLegacyHashRoute,
  navigateToAppRoute as navigateAppRoute,
  syncRouteMode as syncAppRouteMode
} from "~/routing/app-navigation.js";
import { DEFAULT_SETTINGS_SECTION, SETTINGS_SECTION_IDS, MAIN_ROUTE_BY_VIEW, encodePathSegment } from "~/routing/routes.js";
import { createApiClient } from "~/shared/api/client.js";
import { updatePassword } from "~/shared/api/auth.js";
import {
  createPreferenceState,
  detachSystemThemeListener,
  initializePreferences,
  setLocale,
  setThemePreference,
  syncSystemTheme,
  translate
} from "~/shared/composables/app-preferences.js";
import { createManualDiveDraft } from "~/shared/utils/dive-drafts.js";

const DashboardView = defineAsyncComponent(() => import("~/features/dashboard/Dashboard.vue"));
const DiveDetailView = defineAsyncComponent(() => import("~/features/logbook/DiveDetail.vue"));
const DiveImportEditorView = defineAsyncComponent(() => import("~/features/imports/ImportEdit.vue"));
const DiveImportView = defineAsyncComponent(() => import("~/features/imports/Imports.vue"));
const EquipmentView = defineAsyncComponent(() => import("~/features/equipment/Equipment.vue"));
const LogbookEditorView = defineAsyncComponent(() => import("~/features/logbook/LogbookEdit.vue"));
const LoginView = defineAsyncComponent(() => import("~/features/auth/Login.vue"));
const LogsView = defineAsyncComponent(() => import("~/features/logbook/Logs.vue"));
const ManualDiveEntryView = defineAsyncComponent(() => import("~/features/logbook/ManualDive.vue"));
const PublicProfileView = defineAsyncComponent(() => import("~/features/public-profile/PublicProfile.vue"));
const SettingsView = defineAsyncComponent(() => import("~/features/settings/Settings.vue"));

export default {
  name: "AppRouteController",
  components: {
    LoginView,
    DashboardView,
    LogsView,
    ManualDiveEntryView,
    DiveImportView,
    DiveImportEditorView,
    LogbookEditorView,
    DiveDetailView,
    EquipmentView,
    SettingsView,
    PublicProfileView
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const { getToken, isLoaded, isSignedIn, sessionId, signOut } = useAuth();
    const { user } = useUser();
    const divesStore = useDivesStore();
    const profileStore = useProfileStore();
    const equipmentStore = useEquipmentStore();

    return {
      authGetToken: getToken,
      authLoaded: isLoaded,
      authSessionId: sessionId,
      authSignOut: signOut,
      authSignedIn: isSignedIn,
      authUser: user,
      nuxtRoute: route,
      nuxtRouter: router,
      divesStore,
      profileStore,
      equipmentStore
    };
  },
  data() {
    return {
      isAuthenticated: false,
      routePathOverride: null,
      publicRouteSlug: typeof window !== "undefined" ? window.location.pathname.match(/^\/public\/([^/]+)\/?$/)?.[1] || "" : "",
      sessionEmail: "",
      activeView: "dashboard",
      lastAuthenticatedSessionId: null,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      cliAuthCode: "",
      activeSettingsSection: DEFAULT_SETTINGS_SECTION,
      mobileAccountMenuOpen: false,
      desktopAccountMenuOpen: false,
      passwordDialogOpen: false,
      passwordForm: {
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
      },
      passwordSubmitting: false,
      passwordError: "",
      passwordStatus: "",
      filledIconStyle,
      navItems: NAV_ITEMS,
      ...createPreferenceState()
    };
  },
  watch: {
    authLoaded: {
      handler() {
        this.syncAuthState();
      },
      immediate: true
    },
    authSignedIn: {
      handler() {
        this.syncAuthState();
      },
      immediate: true
    },
    authSessionId() {
      this.syncAuthState();
    },
    authUser: {
      handler() {
        this.sessionEmail = this.currentUserEmail;
      },
      deep: true,
      immediate: true
    },
    "nuxtRoute.fullPath": {
      handler() {
        this.handleRouteNavigation();
      }
    },
    selectedDiveId: {
      handler(newId) {
        if (newId) {
          this.fetchSelectedDiveDetails(newId);
        }
      },
      immediate: true
    }
  },
  computed: {
    currentUserEmail() {
      return this.authUser?.primaryEmailAddress?.emailAddress || this.authUser?.emailAddresses?.[0]?.emailAddress || "";
    },
    currentUserName() {
      const firstName = this.authUser?.firstName?.trim() || "";
      const lastName = this.authUser?.lastName?.trim() || "";
      return [firstName, lastName].filter(Boolean).join(" ") || this.currentUserEmail || "Diver";
    },
    currentUserInitials() {
      const source = this.currentUserName || "Diver";
      const initials = source
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("");
      return initials || "DV";
    },
    activeSection() {
      if (this.activeView === "edit" && this.selectedEditDive) {
        return { eyebrow: "Dive Archive", title: "Logbook Editor" };
      }
      if (this.activeView === "create") {
        return { eyebrow: "Dive Archive", title: "Manual Dive Entry" };
      }
      if (this.activeView === "imports" && this.selectedImportDive) {
        return { eyebrow: "Synchronization Module", title: "Imported Dive Editor" };
      }
      if (this.activeView === "imports") {
        return { eyebrow: "Synchronization Module", title: "Imported Dives" };
      }
      if (this.activeView === "logs" && this.selectedDive) {
        return { eyebrow: "Dive Archive", title: "Dive Detail" };
      }
      return this.navItems.find((item) => item.id === this.activeView) || this.navItems[0];
    },
    activeMenuTitle() {
      if (this.activeView === "edit" || this.activeView === "create" || this.activeView === "imports") {
        return this.navItems.find((item) => item.id === "logs")?.label || "Dive Logs";
      }
      if (this.activeView === "logs") {
        return this.navItems.find((item) => item.id === "logs")?.label || "Dive Logs";
      }
      return this.navItems.find((item) => item.id === this.activeView)?.label || "Dashboard";
    },
    backendStatusLabel() {
      if (this.loading) return "Syncing telemetry";
      if (this.error) return "Backend unreachable";
      return this.backendHealthy ? "Backend online" : "Backend idle";
    },
    statusDetail() {
      if (this.loading) return "Waiting for API response.";
      if (this.error) return "Check the backend server and API routes.";
      return `${this.dives.length} dives loaded from /api/dives`;
    },
    isPublicRoute() {
      return Boolean(this.publicRouteSlug);
    },
    canManageUsers() {
      return Boolean(this.authUser?.isOwner);
    },
    desktopNavItems() {
      return this.navItems.filter((item) => item.id !== "map");
    },
    mobileNavItems() {
      return this.navItems;
    },
    loadingViewKey() {
      if (this.activeView === "edit") return "edit";
      if (this.activeView === "create") return "create";
      if (this.activeView === "imports") return "imports";
      if (this.activeView === "map") return "map";
      if (this.activeView === "settings") return "settings";
      if (this.activeView === "equipment") return "equipment";
      if (this.activeView === "logs" && this.selectedDiveId) return "detail";
      if (this.activeView === "logs") return "logs";
      return "dashboard";
    },

    // Dives store bindings
    selectedDiveId: {
      get() {
        return this.divesStore.selectedDiveId;
      },
      set(val) {
        this.divesStore.selectedDiveId = val;
      }
    },
    selectedImportId: {
      get() {
        return this.divesStore.selectedImportId;
      },
      set(val) {
        this.divesStore.selectedImportId = val;
      }
    },
    selectedEditDiveId: {
      get() {
        return this.divesStore.selectedEditDiveId;
      },
      set(val) {
        this.divesStore.selectedEditDiveId = val;
      }
    },
    searchText: {
      get() {
        return this.divesStore.searchText;
      },
      set(val) {
        this.divesStore.searchText = val;
      }
    },
    dives() {
      return this.divesStore.dives;
    },
    committedDives() {
      return this.divesStore.committedDives;
    },
    importedDiveCount() {
      return this.divesStore.importedDiveCount;
    },
    selectedDive() {
      return this.divesStore.selectedDive;
    },
    selectedImportDive() {
      return this.divesStore.selectedImportDive;
    },
    selectedImportDraft() {
      return this.divesStore.selectedImportDraft;
    },
    selectedEditDive() {
      return this.divesStore.selectedEditDive;
    },
    selectedEditDraft() {
      return this.divesStore.selectedEditDraft;
    },
    dashboardStats() {
      return this.divesStore.dashboardStats;
    },
    stats() {
      return this.divesStore.stats;
    },
    loading() {
      return this.divesStore.isLoading;
    },
    error() {
      return this.divesStore.error;
    },
    backendHealthy() {
      return this.divesStore.backendHealthy;
    },
    importDrafts() {
      return this.divesStore.importDrafts;
    },
    savingImportId() {
      return this.divesStore.savingImportId;
    },
    bulkImportSavePending() {
      return this.divesStore.bulkImportSavePending;
    },
    deletingDiveId() {
      return this.divesStore.deletingDiveId;
    },
    importStatusMessage() {
      return this.divesStore.importStatusMessage;
    },
    importError() {
      return this.divesStore.importError;
    },
    manualDiveDraft() {
      return this.divesStore.manualDiveDraft;
    },
    manualDiveCreating() {
      return this.divesStore.manualDiveCreating;
    },
    manualDiveError() {
      return this.divesStore.manualDiveError;
    },

    // Equipment store bindings
    equipment() {
      return this.equipmentStore.equipment;
    },
    defaultEquipmentIds() {
      return this.equipmentStore.defaultEquipmentIds;
    },
    equipmentSaving() {
      return this.equipmentStore.isSaving;
    },
    equipmentServicingId() {
      return this.equipmentStore.servicingId;
    },
    equipmentStatusMessage() {
      return this.equipmentStore.statusMessage;
    },
    equipmentError() {
      return this.equipmentStore.error;
    },

    // Profile store bindings
    profileDiveSites() {
      return this.profileStore.diveSites;
    },
    profileBuddies() {
      return this.profileStore.buddies;
    },
    profileGuides() {
      return this.profileStore.guides;
    },
    profileLogbookDisplayFields() {
      return this.profileStore.logbookDisplayFields;
    },
    profileRequiredLogbookFields() {
      return this.profileStore.requiredLogbookFields;
    },
    profileEquipmentSelectionEnabled() {
      return this.profileStore.equipmentSelectionEnabled;
    }
  },
  methods: {
    t(key, fallback = key, params = {}) {
      return translate(key, fallback, params);
    },
    async setLocale(locale) {
      await setLocale(this, locale);
    },
    setThemePreference(themePreference) {
      setThemePreference(this, themePreference);
    },
    syncSystemTheme() {
      syncSystemTheme(this);
    },
    currentRouteState() {
      return getCurrentRouteState(this);
    },
    syncRouteMode() {
      syncAppRouteMode(this);
    },
    handleRouteNavigation() {
      handleAppRouteNavigation(this);
    },
    async navigateToAppRoute(path, options = {}) {
      await navigateAppRoute(this, path, options);
    },
    normalizeSettingsSection(sectionId) {
      if (!SETTINGS_SECTION_IDS.has(sectionId)) {
        return DEFAULT_SETTINGS_SECTION;
      }
      if (sectionId === "manage-users" && !this.canManageUsers) {
        return DEFAULT_SETTINGS_SECTION;
      }
      return sectionId;
    },
    settingsPath(sectionId = this.activeSettingsSection) {
      return `/settings/${encodePathSegment(this.normalizeSettingsSection(sectionId))}`;
    },
    resetAuthenticatedState() {
      this.isAuthenticated = false;
      this.sessionEmail = "";
      this.divesStore.resetState();
      this.equipmentStore.resetState();
      this.profileStore.resetState();
      this.passwordDialogOpen = false;
      this.passwordForm = {
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
      };
      this.passwordSubmitting = false;
      this.passwordError = "";
      this.passwordStatus = "";
      this.activeSettingsSection = DEFAULT_SETTINGS_SECTION;
      this.desktopAccountMenuOpen = false;
      this.lastAuthenticatedSessionId = null;
    },
    async syncAuthState() {
      if (this.isPublicRoute) {
        this.divesStore.state.loading = false;
        return;
      }

      if (!this.authLoaded) {
        this.divesStore.state.loading = true;
        return;
      }

      this.isAuthenticated = Boolean(this.authSignedIn);
      this.sessionEmail = this.currentUserEmail;

      if (!this.isAuthenticated || !this.authSessionId) {
        this.resetAuthenticatedState();
        return;
      }

      if (this.lastAuthenticatedSessionId === this.authSessionId) {
        return;
      }

      this.lastAuthenticatedSessionId = this.authSessionId;
      this.syncViewFromRoute();
      await Promise.all([this.fetchDives(), this.fetchProfileData(), this.fetchEquipment()]);
    },
    apiClient() {
      return createApiClient({
        getToken: this.authGetToken,
        timeoutMs: this.requestTimeoutMs
      });
    },
    async authenticatedFetch(resource, options = {}, requestOptions = {}) {
      return this.apiClient().request(resource, options, requestOptions);
    },
    setSearchText(value) {
      this.searchText = value;
    },
    toggleMobileAccountMenu() {
      this.mobileAccountMenuOpen = !this.mobileAccountMenuOpen;
    },
    closeMobileAccountMenu() {
      this.mobileAccountMenuOpen = false;
      this.desktopAccountMenuOpen = false;
    },
    toggleDesktopAccountMenu() {
      this.desktopAccountMenuOpen = !this.desktopAccountMenuOpen;
    },
    closeDesktopAccountMenu() {
      this.desktopAccountMenuOpen = false;
    },
    async openMobileSettings() {
      this.closeMobileAccountMenu();
      this.closeDesktopAccountMenu();
      await this.setView("settings");
    },
    async signOutUser() {
      this.closeMobileAccountMenu();
      this.closeDesktopAccountMenu();
      if (typeof this.authSignOut !== "function") {
        return;
      }
      await this.authSignOut({ redirectUrl: "/" });
    },
    openPasswordDialog() {
      this.closeMobileAccountMenu();
      this.closeDesktopAccountMenu();
      this.passwordDialogOpen = true;
      this.passwordError = "";
      this.passwordStatus = "";
      this.passwordForm = {
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
      };
    },
    closePasswordDialog() {
      this.passwordDialogOpen = false;
      this.passwordSubmitting = false;
      this.passwordError = "";
      this.passwordStatus = "";
      this.passwordForm = {
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
      };
    },
    async submitPasswordChange() {
      this.passwordSubmitting = true;
      this.passwordError = "";
      this.passwordStatus = "";
      const currentPassword = this.passwordForm.currentPassword;
      const newPassword = this.passwordForm.newPassword;
      const confirmPassword = this.passwordForm.confirmPassword;
      if (!currentPassword || !newPassword) {
        this.passwordError = "Current password and new password are required.";
        this.passwordSubmitting = false;
        return;
      }
      if (newPassword.length < 8) {
        this.passwordError = "New password must be at least 8 characters.";
        this.passwordSubmitting = false;
        return;
      }
      if (newPassword !== confirmPassword) {
        this.passwordError = "New password confirmation does not match.";
        this.passwordSubmitting = false;
        return;
      }
      try {
        const response = await updatePassword(this.apiClient(), {
          current_password: currentPassword,
          new_password: newPassword
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || `API returned ${response.status}`);
        }
        this.passwordStatus = "Password updated.";
        window.setTimeout(() => {
          if (this.passwordDialogOpen) {
            this.closePasswordDialog();
          }
        }, 900);
      } catch (error) {
        this.passwordError = error?.message || "Could not update the password.";
      } finally {
        this.passwordSubmitting = false;
      }
    },
    isDisabledNavItem(view) {
      return Boolean(this.navItems.find((item) => item.id === view)?.disabled);
    },
    async handleNavItemClick(view) {
      if (this.isDisabledNavItem(view)) {
        return;
      }
      await this.setView(view);
    },
    async setView(view) {
      if (this.isDisabledNavItem(view)) {
        return;
      }
      this.closeMobileAccountMenu();
      this.activeView = view;
      if (view !== "logs") this.selectedDiveId = null;
      if (view !== "imports") this.selectedImportId = null;
      if (view !== "edit") this.selectedEditDiveId = null;
      if (view !== "create") this.divesStore.state.manualDiveError = "";
      if (view !== "settings") this.cliAuthCode = "";
      this.divesStore.state.importError = "";
      this.divesStore.state.importStatusMessage = "";
      await this.navigateToAppRoute(MAIN_ROUTE_BY_VIEW[view] || "/");
      if (this.isAuthenticated && ["dashboard", "logs", "imports", "edit"].includes(view)) {
        await this.fetchDives();
      }
    },
    async openManualDiveCreator() {
      this.closeMobileAccountMenu();
      this.activeView = "create";
      this.selectedDiveId = null;
      this.selectedImportId = null;
      this.selectedEditDiveId = null;
      this.divesStore.state.manualDiveDraft = createManualDiveDraft();
      this.divesStore.state.manualDiveCreating = false;
      this.divesStore.state.manualDiveError = "";
      this.divesStore.state.importError = "";
      this.divesStore.state.importStatusMessage = "";
      await this.navigateToAppRoute("/logs/create");
    },
    async closeManualDiveCreator() {
      this.closeMobileAccountMenu();
      this.activeView = "logs";
      this.divesStore.state.manualDiveError = "";
      await this.navigateToAppRoute("/logs");
    },
    updateManualDiveDraft(key, value) {
      this.divesStore.updateManualDiveDraft(key, value);
    },
    async setSettingsSection(sectionId) {
      this.closeMobileAccountMenu();
      this.activeView = "settings";
      this.activeSettingsSection = this.normalizeSettingsSection(sectionId);
      this.selectedDiveId = null;
      this.selectedImportId = null;
      this.selectedEditDiveId = null;
      this.cliAuthCode = "";
      this.divesStore.state.importError = "";
      this.divesStore.state.importStatusMessage = "";
      await this.navigateToAppRoute(this.settingsPath(this.activeSettingsSection));
    },
    async openDive(diveId) {
      this.closeMobileAccountMenu();
      this.activeView = "logs";
      this.selectedDiveId = diveId;
      this.selectedImportId = null;
      this.selectedEditDiveId = null;
      this.fetchSelectedDiveDetails(diveId);
      await this.navigateToAppRoute(`/logs/${encodePathSegment(diveId)}`);
    },
    async closeDiveDetail() {
      this.closeMobileAccountMenu();
      this.activeView = "logs";
      this.selectedDiveId = null;
      this.selectedEditDiveId = null;
      await this.navigateToAppRoute("/logs");
    },
    resolvePendingImportId(dives = this.dives, drafts = this.importDrafts, preferredId = null) {
      return this.divesStore.resolvePendingImportId(dives, drafts, preferredId);
    },
    isPendingImportId(diveId, dives = this.dives, drafts = this.importDrafts) {
      return this.divesStore.isPendingImportId(diveId, dives, drafts);
    },
    async openImportQueue(diveId = null) {
      this.closeMobileAccountMenu();
      this.activeView = "imports";
      this.selectedDiveId = null;
      this.selectedEditDiveId = null;
      this.divesStore.state.importError = "";
      this.divesStore.state.importStatusMessage = "";
      if (this.isAuthenticated) {
        await this.fetchDives();
      }
      this.selectedImportId = diveId ? this.resolvePendingImportId(this.dives, this.importDrafts, diveId) : null;
      await this.navigateToAppRoute(this.selectedImportId ? `/imports/${encodePathSegment(this.selectedImportId)}` : "/imports");
    },
    async selectImportDive(diveId) {
      this.closeMobileAccountMenu();
      this.activeView = "imports";
      this.selectedDiveId = null;
      this.selectedEditDiveId = null;
      this.selectedImportId = this.resolvePendingImportId(this.dives, this.importDrafts, diveId);
      this.divesStore.state.importError = "";
      this.divesStore.state.importStatusMessage = "";
      await this.navigateToAppRoute(this.selectedImportId ? `/imports/${encodePathSegment(this.selectedImportId)}` : "/imports");
    },
    async backToImportQueue() {
      this.closeMobileAccountMenu();
      this.activeView = "imports";
      this.selectedDiveId = null;
      this.selectedImportId = null;
      this.selectedEditDiveId = null;
      await this.navigateToAppRoute("/imports");
    },
    async openDiveEditor(diveId) {
      this.closeMobileAccountMenu();
      this.activeView = "edit";
      this.selectedDiveId = null;
      this.selectedImportId = null;
      this.selectedEditDiveId = diveId;
      this.divesStore.state.importError = "";
      this.divesStore.state.importStatusMessage = "";
      if (this.isAuthenticated) {
        await this.fetchDives();
      }
      if (!this.selectedEditDive) {
        this.selectedEditDiveId = null;
        await this.navigateToAppRoute("/logs");
        return;
      }
      await this.navigateToAppRoute(`/logs/${encodePathSegment(diveId)}/edit`);
    },
    async closeDiveEditor() {
      this.closeMobileAccountMenu();
      if (!this.selectedEditDiveId) {
        this.activeView = "logs";
        await this.navigateToAppRoute("/logs");
        return;
      }
      this.activeView = "logs";
      this.selectedDiveId = this.selectedEditDiveId;
      this.selectedEditDiveId = null;
      await this.navigateToAppRoute(`/logs/${encodePathSegment(this.selectedDiveId)}`);
    },
    updateImportDraft(diveId, key, value) {
      this.divesStore.updateImportDraftField(diveId, key, value);
    },
    async createManualDive() {
      const created = await this.divesStore.createManualDive({
        requiredLogbookFields: this.profileRequiredLogbookFields,
        equipmentSelectionEnabled: this.profileEquipmentSelectionEnabled,
        apiClient: this.apiClient()
      });
      if (created?.id) {
        this.openDive(created.id);
      } else if (!this.manualDiveError) {
        await this.setView("logs");
      }
    },
    async uploadCsvImport(file, options = {}) {
      const dryRun = options.dryRun === true;
      const navigateToQueue = options.navigateToQueue !== false;
      const payload = await this.divesStore.uploadCsvImport(file, options, this.apiClient());
      if (!dryRun && navigateToQueue) {
        this.activeView = "imports";
        this.selectedImportId = this.resolvePendingImportId(this.dives, this.importDrafts, null);
        await this.navigateToAppRoute(this.selectedImportId ? `/imports/${encodePathSegment(this.selectedImportId)}` : "/imports");
      }
      return payload;
    },
    async uploadSubsurfaceImport(file, options = {}) {
      return this.divesStore.uploadSubsurfaceImport(file, options, this.apiClient());
    },
    async saveImportDraft(diveId, commit = false) {
      const id = String(diveId);
      const dive = this.dives.find((entry) => String(entry.id) === id);
      const wasCommitted = dive ? isCommittedDive(dive) : false;

      const updated = await this.divesStore.saveImportDraft(diveId, commit, this.profileRequiredLogbookFields, this.apiClient());
      if (!updated) {
        return false;
      }

      if ((commit || wasCommitted) && !wasCommitted) {
        this.selectedImportId = this.resolvePendingImportId(this.dives, this.importDrafts, null);
        await this.navigateToAppRoute(this.selectedImportId ? `/imports/${encodePathSegment(this.selectedImportId)}` : "/imports");
      }
      return true;
    },
    async saveExistingDiveLogbook(diveId) {
      return this.saveImportDraft(diveId, true);
    },
    async createDiveSite(sitePayload) {
      return this.profileStore.createDiveSite(sitePayload, this.apiClient());
    },
    async searchDiveSiteLocation(query) {
      const payload = await this.profileStore.searchLocation(query, this.apiClient());
      if (!payload?.found || !payload?.result) {
        return null;
      }
      return payload.result;
    },
    async deleteDive(diveId) {
      const id = String(diveId);
      const dive = this.dives.find((entry) => String(entry.id) === id);
      if (!dive) {
        this.divesStore.state.importError = "Dive could not be found for deletion.";
        this.divesStore.state.importStatusMessage = "";
        return false;
      }

      const importedRecord = !isCommittedDive(dive);
      const confirmed = window.confirm(
        importedRecord
          ? `Delete ${paddedDiveIndex(dive)} from the import queue? This cannot be undone.`
          : `Delete ${paddedDiveIndex(dive, this.dives)} from the dive log? This cannot be undone.`
      );
      if (!confirmed) {
        return false;
      }

      const success = await this.divesStore.deleteDive(diveId, this.apiClient());
      if (success) {
        if (importedRecord) {
          this.activeView = "imports";
          await this.navigateToAppRoute("/imports");
        } else {
          this.activeView = "logs";
          await this.navigateToAppRoute("/logs");
        }
      }
      return success;
    },
    async applyBuddyGuideToPendingImports(diveId) {
      return this.divesStore.applyBuddyGuideToPending(diveId, this.apiClient());
    },
    cycleView() {
      const currentView = this.activeView === "logs" ? "logs" : this.activeView;
      const index = this.navItems.findIndex((item) => item.id === currentView);
      for (let offset = 1; offset <= this.navItems.length; offset += 1) {
        const next = this.navItems[(index + offset) % this.navItems.length];
        if (!next.disabled) {
          this.setView(next.id);
          return;
        }
      }
    },
    syncViewFromRoute() {
      if (!this.isAuthenticated) return;
      const state = this.currentRouteState();
      if (state.publicRouteSlug) return;

      this.activeView = state.activeView || "dashboard";
      this.selectedDiveId = state.selectedDiveId || null;
      this.selectedImportId = state.selectedImportId || null;
      this.selectedEditDiveId = state.selectedEditDiveId || null;
      this.cliAuthCode = state.cliAuthCode || "";

      if (this.activeView === "create") {
        this.divesStore.state.manualDiveError = "";
      }

      if (this.activeView === "settings") {
        this.activeSettingsSection = this.normalizeSettingsSection(state.activeSettingsSection);
      } else {
        this.activeSettingsSection = DEFAULT_SETTINGS_SECTION;
      }
    },
    async fetchDives() {
      await this.divesStore.fetchDives(this.apiClient());
      if (this.selectedDiveId) {
        this.fetchSelectedDiveDetails(this.selectedDiveId);
      }
      if (this.selectedImportId && !this.isPendingImportId(this.selectedImportId, this.dives, this.importDrafts)) {
        this.selectedImportId = null;
        if (this.activeView === "imports") {
          await this.navigateToAppRoute("/imports", { replace: true });
        }
      }
      if (
        this.selectedEditDiveId &&
        !this.dives.some((dive) => String(dive.id) === String(this.selectedEditDiveId) && isCommittedDive(dive))
      ) {
        this.selectedEditDiveId = null;
        if (this.activeView === "edit") {
          await this.navigateToAppRoute("/logs", { replace: true });
        }
      }
    },
    async fetchSelectedDiveDetails(diveId) {
      return this.divesStore.fetchDiveDetail(diveId, this.apiClient());
    },
    async fetchProfileData() {
      try {
        await this.profileStore.fetchProfile(this.apiClient());
      } catch {
        // Handled in store
      }
    },
    async fetchEquipment() {
      try {
        await this.equipmentStore.fetchEquipment(this.apiClient());
      } catch {
        // Handled in store
      }
    },
    async saveEquipment(equipment) {
      return this.equipmentStore.saveEquipment(equipment, this.apiClient());
    },
    async markEquipmentServiced(equipmentId) {
      return this.equipmentStore.markServiced(equipmentId, this.apiClient());
    },
    handleProfileUpdated(payload) {
      this.profileStore.hydrateProfileState(payload);
    }
  },
  async mounted() {
    await initializeLegacyHashRoute(this);
    await initializePreferences(this);
    this.syncRouteMode();
    this.syncViewFromRoute();
    this.syncAuthState();
  },
  beforeUnmount() {
    detachSystemThemeListener(this);
  }
};
</script>

<template>
  <public-profile-view v-if="isPublicRoute" :slug="publicRouteSlug"></public-profile-view>
  <div v-else-if="!authLoaded" class="flex min-h-screen items-center justify-center bg-background px-6 text-on-background">
    <section class="bg-surface-container-low p-10 shadow-panel">
      <p class="font-headline text-2xl font-bold">Loading secure access...</p>
    </section>
  </div>
  <login-view v-else-if="!isAuthenticated" :current-locale="i18nLocale" :set-locale="setLocale"></login-view>
  <div v-else class="app-stage relative min-h-screen overflow-hidden bg-background text-on-background">
    <div class="app-stage-wave auth-stage-wave auth-stage-wave-back"></div>
    <div class="app-stage-wave auth-stage-wave auth-stage-wave-front"></div>
    <div class="app-stage-caustics auth-stage-caustics"></div>
    <aside class="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-background shadow-[40px_0_40px_-20px_rgba(0,15,29,0.4)] md:flex">
      <div class="flex justify-center px-4 pb-2 pt-5">
        <div class="flex h-32 w-full items-center justify-center rounded-3xl shadow-panel">
          <img src="/logo-headline.png" alt="DiveVault" class="max-h-full w-full object-contain p-2" />
        </div>
      </div>
      <nav class="mt-6 flex-1 space-y-2">
        <div v-for="item in desktopNavItems" :key="item.id" class="space-y-2">
          <button
            type="button"
            @click="handleNavItemClick(item.id)"
            :disabled="item.disabled"
            class="group flex w-full items-center gap-4 p-4 text-left transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-100"
            :class="
              item.disabled
                ? 'border-l-4 border-tertiary bg-tertiary/12 text-tertiary'
                : activeView === item.id || (activeView === 'create' && item.id === 'logs')
                  ? 'border-r-4 border-primary bg-surface-container-high/70 text-primary'
                  : 'text-secondary opacity-70 hover:bg-surface-container-high hover:text-primary hover:opacity-100'
            "
          >
            <span
              class="material-symbols-outlined transition-transform group-active:scale-90"
              :style="(activeView === item.id || (activeView === 'create' && item.id === 'logs')) && !item.disabled ? filledIconStyle : ''"
              >{{ item.icon }}</span
            >
            <span class="hidden items-center gap-2 font-label text-[11px] font-bold md:flex">
              <span>{{ item.label }}</span>
              <span v-if="item.badge" class="rounded bg-tertiary px-2 py-0.5 text-[9px] font-black tracking-[0.18em] text-background">{{
                item.badge
              }}</span>
            </span>
          </button>
        </div>
      </nav>
      <div class="mt-auto p-6">
        <button
          type="button"
          @click="openManualDiveCreator()"
          class="hidden w-full items-center justify-center gap-2 bg-primary px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-primary transition-all hover:brightness-110 md:flex"
        >
          <span class="material-symbols-outlined text-sm">add</span>
          Log New Dive
        </button>
      </div>
    </aside>
    <header
      class="fixed left-0 right-0 top-0 z-30 h-16 border-b border-primary/10 bg-surface-container-high/95 backdrop-blur-xl md:left-64 md:bg-background/80"
    >
      <div class="relative flex h-full items-center justify-between px-6 md:hidden">
        <div class="flex items-center gap-3">
          <div class="flex h-14 w-14 items-center justify-center rounded-2xl shadow-panel">
            <img src="/logo.png" alt="DiveVault" class="max-h-full max-w-full object-contain p-1" />
          </div>
          <h2 class="font-headline text-lg font-bold uppercase tracking-[0.14em] text-primary">{{ activeMenuTitle }}</h2>
        </div>
        <div class="relative">
          <UButton
            @click="toggleMobileAccountMenu"
            class="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-surface-container-high text-[11px] font-bold uppercase tracking-[0.12em] text-primary"
          >
            {{ currentUserInitials }}
          </UButton>
          <div
            v-if="mobileAccountMenuOpen"
            class="absolute right-0 top-[calc(100%+0.75rem)] z-40 w-56 rounded-2xl border border-primary/10 bg-surface-container-low p-3 shadow-panel"
          >
            <div class="border-b border-primary/10 pb-3">
              <p class="truncate text-sm font-semibold text-on-surface">{{ currentUserName }}</p>
              <p class="mt-1 truncate text-xs text-secondary">{{ currentUserEmail }}</p>
            </div>
            <div class="mt-3 flex flex-col gap-2">
              <UButton
                @click="openMobileSettings()"
                class="inline-flex items-center justify-center rounded-xl bg-surface-container-high px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-highest"
              >
                Open Settings
              </UButton>
              <UButton
                @click="openPasswordDialog"
                class="inline-flex items-center justify-center rounded-xl bg-surface-container-high px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-highest"
              >
                Change Password
              </UButton>
              <UButton
                @click="signOutUser"
                class="inline-flex items-center justify-center rounded-xl border border-primary/15 px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-high"
              >
                Sign Out
              </UButton>
            </div>
          </div>
        </div>
      </div>
      <div class="hidden h-full items-center justify-between px-8 md:flex">
        <h2 class="font-headline text-2xl font-bold tracking-[0.08em] text-primary">{{ activeMenuTitle }}</h2>
        <div class="relative flex items-center gap-4 border-l border-primary/10 pl-5 text-on-surface">
          <div class="min-w-0 text-right">
            <p class="font-label text-[9px] font-bold uppercase tracking-[0.18em] text-secondary/70">Diver</p>
            <p class="max-w-[11rem] truncate text-sm font-semibold leading-5 text-on-surface">{{ currentUserName }}</p>
          </div>
          <UButton
            @click="toggleDesktopAccountMenu"
            type="button"
            aria-label="Account menu"
            :aria-expanded="desktopAccountMenuOpen ? 'true' : 'false'"
            class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-background/50 text-[11px] font-bold uppercase tracking-[0.12em] text-primary shadow-[inset_0_1px_0_rgba(205,229,255,0.08)] transition-colors hover:border-primary/35 hover:bg-primary/12"
          >
            {{ currentUserInitials }}
            <span
              class="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-background bg-surface-container-high text-secondary"
            >
              <span
                class="material-symbols-outlined text-[14px] transition-transform"
                :class="desktopAccountMenuOpen ? 'rotate-180 text-primary' : ''"
                >expand_more</span
              >
            </span>
          </UButton>
          <div
            v-if="desktopAccountMenuOpen"
            class="absolute right-0 top-[calc(100%+0.75rem)] z-40 w-56 rounded-2xl border border-primary/10 bg-surface-container-low p-3 shadow-panel"
          >
            <div class="border-b border-primary/10 pb-3">
              <p class="truncate text-sm font-semibold text-on-surface">{{ currentUserName }}</p>
              <p class="mt-1 truncate text-xs text-secondary">{{ currentUserEmail }}</p>
            </div>
            <div class="mt-3 flex flex-col gap-2">
              <UButton
                @click="openPasswordDialog"
                class="inline-flex items-center justify-center rounded-xl bg-surface-container-high px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-highest"
              >
                Change Password
              </UButton>
              <UButton
                @click="signOutUser"
                class="inline-flex items-center justify-center rounded-xl border border-primary/15 px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-high"
              >
                Sign Out
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </header>
    <section role="main" class="relative z-10 md:ml-64" :class="activeView === 'map' ? 'px-0 pb-0 pt-16' : 'pb-24 pt-20'">
      <div
        class="mx-auto"
        :class="activeView === 'map' ? 'w-full max-w-none px-0 md:max-w-[96rem] md:px-8' : 'max-w-md px-4 md:max-w-[96rem] md:px-8'"
      >
        <section v-if="loading" class="space-y-6">
          <div class="border border-primary/10 bg-surface-container-low p-6 shadow-panel animate-pulse">
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
              {{
                loadingViewKey === "dashboard"
                  ? "Loading Dashboard"
                  : loadingViewKey === "map"
                    ? "Loading Dive Map"
                    : loadingViewKey === "logs"
                      ? "Loading Dive Log"
                      : loadingViewKey === "detail"
                        ? "Loading Dive Detail"
                        : loadingViewKey === "imports"
                          ? "Loading Imports"
                          : loadingViewKey === "edit"
                            ? "Loading Dive Editor"
                            : loadingViewKey === "create"
                              ? "Loading Manual Entry"
                              : loadingViewKey === "equipment"
                                ? "Loading Equipment"
                                : "Loading Settings"
              }}
            </p>
            <div class="mt-4 h-9 w-56 bg-surface-container-high"></div>
            <div class="mt-3 h-4 w-72 max-w-full bg-surface-container-high/80"></div>
          </div>

          <div v-if="loadingViewKey === 'dashboard'" class="space-y-6 animate-pulse">
            <div class="dashboard-command-center space-y-6">
              <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div
                  v-for="index in 4"
                  :key="'dashboard-stat-' + index"
                  class="h-36 rounded-2xl bg-surface-container-low shadow-panel"
                ></div>
              </div>
              <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <div class="space-y-6">
                  <div class="h-[28rem] rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
                  <div class="grid gap-4 md:grid-cols-3">
                    <div
                      v-for="index in 3"
                      :key="'dashboard-recent-' + index"
                      class="h-28 rounded-2xl bg-surface-container-low shadow-panel"
                    ></div>
                  </div>
                </div>
                <div class="space-y-4">
                  <div class="h-44 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
                  <div class="h-44 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="loadingViewKey === 'map'" class="dashboard-command-center dashboard-map-only animate-pulse">
            <section class="dashboard-section dashboard-map-section relative min-h-[calc(100vh-10rem)]">
              <div
                class="dashboard-glass-card dashboard-map-panel relative h-full min-h-[calc(100vh-10rem)] overflow-hidden rounded-[1.5rem] bg-surface-container-low shadow-panel"
              >
                <div class="absolute left-6 top-6 z-10 space-y-3">
                  <div class="h-4 w-40 rounded bg-surface-container-high"></div>
                  <div class="h-9 w-72 rounded bg-surface-container-high"></div>
                  <div class="h-4 w-96 max-w-full rounded bg-surface-container-high"></div>
                </div>
                <div class="absolute inset-0 bg-surface-container-high/60"></div>
                <div class="absolute inset-0 technical-grid opacity-[0.12]"></div>
                <div class="absolute bottom-8 left-8 flex gap-3">
                  <div v-for="index in 4" :key="'map-site-chip-' + index" class="h-14 w-44 rounded-xl bg-surface-container-low"></div>
                </div>
              </div>
            </section>
          </div>

          <div v-else-if="loadingViewKey === 'equipment'" class="dashboard-command-center animate-pulse">
            <div class="flex justify-end">
              <div class="h-12 w-[24rem] rounded-xl bg-surface-container-low shadow-panel"></div>
            </div>
            <div class="settings-stat-strip">
              <div v-for="index in 2" :key="'equipment-stat-' + index" class="h-20 rounded-2xl bg-surface-container-low shadow-panel"></div>
            </div>
            <div class="equipment-page-layout">
              <aside class="settings-panel settings-card equipment-service-sidebar h-[34rem] bg-surface-container-low shadow-panel"></aside>
              <section class="min-w-0">
                <div class="equipment-items-grid">
                  <div
                    v-for="index in 6"
                    :key="'equipment-card-' + index"
                    class="h-64 rounded-2xl bg-surface-container-low shadow-panel"
                  ></div>
                </div>
              </section>
            </div>
          </div>

          <div v-else-if="loadingViewKey === 'logs'" class="space-y-6 animate-pulse">
            <div class="dashboard-command-center space-y-6">
              <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div v-for="index in 4" :key="'logs-stat-' + index" class="h-32 rounded-2xl bg-surface-container-low shadow-panel"></div>
              </div>
              <div class="grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_0.65fr]">
                <div class="h-24 rounded-2xl bg-surface-container-low shadow-panel"></div>
                <div class="h-24 rounded-2xl bg-surface-container-low shadow-panel"></div>
              </div>
              <div class="space-y-4">
                <div v-for="index in 5" :key="'logs-card-' + index" class="h-36 rounded-2xl bg-surface-container-low shadow-panel"></div>
              </div>
            </div>
          </div>

          <div v-else-if="loadingViewKey === 'detail'" class="space-y-6 animate-pulse">
            <div class="relative h-[19rem] overflow-hidden rounded-[2rem] bg-surface-container-low shadow-panel">
              <div class="absolute left-8 top-8 h-11 w-36 rounded-xl bg-surface-container-high"></div>
              <div class="absolute bottom-8 left-8 right-8 space-y-5">
                <div class="h-5 w-80 rounded bg-surface-container-high"></div>
                <div class="h-14 max-w-3xl rounded bg-surface-container-high"></div>
                <div class="flex flex-wrap gap-10">
                  <div v-for="index in 4" :key="'detail-hero-metric-' + index" class="space-y-2">
                    <div class="h-3 w-24 rounded bg-surface-container-high"></div>
                    <div class="h-8 w-20 rounded bg-surface-container-high"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="grid grid-cols-12 gap-6">
              <div class="col-span-12 space-y-6 xl:col-span-8">
                <div class="rounded-[1.5rem] bg-surface-container-low p-6 shadow-panel">
                  <div class="mb-6 flex items-center justify-between">
                    <div class="h-6 w-52 rounded bg-surface-container-high"></div>
                    <div class="h-7 w-24 rounded-full bg-surface-container-high"></div>
                  </div>
                  <div class="grid grid-cols-3 gap-4">
                    <div v-for="index in 6" :key="'detail-logbook-' + index" class="h-24 rounded-xl bg-surface-container-high"></div>
                  </div>
                </div>
                <div class="h-[20rem] rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
              </div>
              <div class="col-span-12 xl:col-span-4">
                <div class="rounded-[1.5rem] bg-surface-container-low p-6 shadow-panel">
                  <div class="mb-5 h-5 w-56 rounded bg-surface-container-high"></div>
                  <div class="divide-y divide-primary/10">
                    <div v-for="index in 4" :key="'detail-telemetry-' + index" class="space-y-3 py-5 first:pt-0 last:pb-0">
                      <div class="h-5 w-5 rounded bg-surface-container-high"></div>
                      <div class="h-3 w-32 rounded bg-surface-container-high"></div>
                      <div class="h-7 w-28 rounded bg-surface-container-high"></div>
                      <div class="h-3 w-40 rounded bg-surface-container-high"></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="col-span-12 pt-8">
                <div class="mb-5 h-6 w-44 rounded bg-surface-container-high"></div>
                <div class="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4">
                  <div
                    v-for="index in 5"
                    :key="'detail-equipment-' + index"
                    class="h-20 rounded-xl bg-surface-container-low shadow-panel"
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="loadingViewKey === 'imports'" class="space-y-6 animate-pulse">
            <div class="h-36 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.82fr)]">
              <div class="space-y-4">
                <div v-for="index in 5" :key="'imports-row-' + index" class="h-28 rounded-2xl bg-surface-container-low shadow-panel"></div>
              </div>
              <div class="space-y-4">
                <div class="h-48 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
                <div class="h-48 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
              </div>
            </div>
          </div>

          <div v-else-if="loadingViewKey === 'edit'" class="space-y-6 animate-pulse">
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_22rem]">
              <div class="space-y-6">
                <div class="h-48 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
                <div class="rounded-[1.5rem] bg-surface-container-low p-6 shadow-panel">
                  <div class="grid gap-4 md:grid-cols-2">
                    <div v-for="index in 10" :key="'edit-field-' + index" class="h-16 rounded-xl bg-surface-container-high"></div>
                  </div>
                </div>
              </div>
              <div class="space-y-4">
                <div class="h-64 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
                <div class="h-40 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
              </div>
            </div>
          </div>

          <div v-else-if="loadingViewKey === 'create'" class="space-y-6 animate-pulse">
            <div class="h-40 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_22rem]">
              <div class="rounded-[1.5rem] bg-surface-container-low p-6 shadow-panel">
                <div class="grid gap-4 md:grid-cols-2">
                  <div v-for="index in 12" :key="'create-field-' + index" class="h-16 rounded-xl bg-surface-container-high"></div>
                </div>
              </div>
              <div class="space-y-4">
                <div class="h-56 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
                <div class="h-56 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
              </div>
            </div>
          </div>

          <div v-else class="settings-layout animate-pulse">
            <aside class="settings-section-nav h-[42rem] bg-surface-container-low shadow-panel">
              <div class="space-y-3 p-4">
                <div v-for="index in 8" :key="'settings-nav-' + index" class="h-14 rounded-xl bg-surface-container-high"></div>
              </div>
            </aside>
            <section class="min-w-0 space-y-6">
              <div class="h-40 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
              <div class="grid gap-6 md:grid-cols-2">
                <div
                  v-for="index in 4"
                  :key="'settings-panel-' + index"
                  class="h-56 rounded-[1.5rem] bg-surface-container-low shadow-panel"
                ></div>
              </div>
            </section>
          </div>
        </section>
        <section v-else-if="error" class="bg-error-container/25 p-10 shadow-panel">
          <p class="font-headline text-2xl font-bold text-on-error-container">Frontend could not load dive data</p>
          <p class="mt-2 text-sm text-on-error-container">{{ error }}</p>
          <UButton
            @click="fetchDives"
            class="mt-5 bg-primary px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-primary"
            >Retry</UButton
          >
        </section>
        <div v-else-if="activeView === 'dashboard'">
          <dashboard-view
            display-mode="dashboard"
            :dives="committedDives"
            :all-dives="dives"
            :dive-sites="profileDiveSites"
            :stats="stats"
            :set-view="setView"
            :backend-healthy="backendHealthy"
            :open-dive="openDive"
            :current-user-name="currentUserName"
            :imported-dive-count="importedDiveCount"
            :open-import-queue="openImportQueue"
          ></dashboard-view>
        </div>
        <div v-else-if="activeView === 'map'">
          <dashboard-view
            display-mode="map"
            :dives="committedDives"
            :all-dives="dives"
            :dive-sites="profileDiveSites"
            :stats="stats"
            :set-view="setView"
            :backend-healthy="backendHealthy"
            :open-dive="openDive"
            :current-user-name="currentUserName"
            :imported-dive-count="importedDiveCount"
            :open-import-queue="openImportQueue"
          ></dashboard-view>
        </div>
        <div v-else-if="activeView === 'logs' && !selectedDive">
          <logs-view
            :dives="committedDives"
            :dive-sites="profileDiveSites"
            :logbook-display-fields="profileLogbookDisplayFields"
            :search-text="searchText"
            :open-dive="openDive"
            :open-import-queue="openImportQueue"
            :open-manual-dive="openManualDiveCreator"
            :set-search-text="setSearchText"
            :delete-dive="deleteDive"
            :deleting-dive-id="deletingDiveId"
            :status-message="importStatusMessage"
            :error-message="importError"
          ></logs-view>
        </div>
        <div v-else-if="activeView === 'create'">
          <manual-dive-entry-view
            :draft="manualDiveDraft"
            :required-logbook-fields="profileRequiredLogbookFields"
            :dive-sites="profileDiveSites"
            :buddies="profileBuddies"
            :guides="profileGuides"
            :equipment="equipment"
            :default-equipment-ids="defaultEquipmentIds"
            :equipment-selection-enabled="profileEquipmentSelectionEnabled"
            :creating="manualDiveCreating"
            :error-message="manualDiveError"
            :update-draft="updateManualDiveDraft"
            :create-manual-dive="createManualDive"
            :close-creator="closeManualDiveCreator"
            :create-dive-site="createDiveSite"
            :search-dive-site-location="searchDiveSiteLocation"
          ></manual-dive-entry-view>
        </div>
        <div v-else-if="activeView === 'imports' && selectedImportDive">
          <dive-import-editor-view
            :dive="selectedImportDive"
            :draft="selectedImportDraft"
            :required-logbook-fields="profileRequiredLogbookFields"
            :dive-sites="profileDiveSites"
            :buddies="profileBuddies"
            :guides="profileGuides"
            :equipment="equipment"
            :default-equipment-ids="defaultEquipmentIds"
            :equipment-selection-enabled="profileEquipmentSelectionEnabled"
            :saving-import-id="savingImportId"
            :bulk-import-save-pending="bulkImportSavePending"
            :deleting-dive-id="deletingDiveId"
            :import-error="importError"
            :import-status-message="importStatusMessage"
            :update-import-draft="updateImportDraft"
            :save-import-draft="saveImportDraft"
            :delete-dive="deleteDive"
            :apply-buddy-guide-to-pending-imports="applyBuddyGuideToPendingImports"
            :create-dive-site="createDiveSite"
            :back-to-queue="backToImportQueue"
          ></dive-import-editor-view>
        </div>
        <div v-else-if="activeView === 'imports'">
          <dive-import-view
            :dives="dives"
            :import-drafts="importDrafts"
            :required-logbook-fields="profileRequiredLogbookFields"
            :selected-import-id="selectedImportId"
            :select-import-dive="selectImportDive"
            :deleting-dive-id="deletingDiveId"
            :import-error="importError"
            :import-status-message="importStatusMessage"
            :delete-dive="deleteDive"
            :set-view="setView"
            :fetch-dives="fetchDives"
          ></dive-import-view>
        </div>
        <div v-else-if="activeView === 'edit' && selectedEditDive">
          <logbook-editor-view
            :dive="selectedEditDive"
            :all-dives="dives"
            :draft="selectedEditDraft"
            :required-logbook-fields="profileRequiredLogbookFields"
            :dive-sites="profileDiveSites"
            :buddies="profileBuddies"
            :guides="profileGuides"
            :equipment="equipment"
            :default-equipment-ids="defaultEquipmentIds"
            :equipment-selection-enabled="profileEquipmentSelectionEnabled"
            :saving-import-id="savingImportId"
            :deleting-dive-id="deletingDiveId"
            :status-message="importStatusMessage"
            :error-message="importError"
            :update-dive-draft="updateImportDraft"
            :save-dive-logbook="saveExistingDiveLogbook"
            :delete-dive="deleteDive"
            :create-dive-site="createDiveSite"
            :close-editor="closeDiveEditor"
          ></logbook-editor-view>
        </div>
        <div v-else-if="activeView === 'logs' && selectedDive">
          <dive-detail-view
            :dive="selectedDive"
            :all-dives="dives"
            :dive-sites="profileDiveSites"
            :deleting-dive-id="deletingDiveId"
            :close-detail="closeDiveDetail"
            :open-dive-editor="openDiveEditor"
            :delete-dive="deleteDive"
          ></dive-detail-view>
        </div>
        <div v-else-if="activeView === 'equipment'">
          <equipment-view
            :equipment="equipment"
            :search-text="searchText"
            :set-search-text="setSearchText"
            :saving="equipmentSaving"
            :status-message="equipmentStatusMessage"
            :error-message="equipmentError"
            :save-equipment="saveEquipment"
          ></equipment-view>
        </div>
        <div v-else-if="activeView === 'settings'">
          <settings-view
            :cli-auth-code="cliAuthCode"
            :active-section="activeSettingsSection"
            :set-active-section="setSettingsSection"
            :profile-updated="handleProfileUpdated"
            :refresh-dives="fetchDives"
            :open-import-queue="openImportQueue"
            :upload-csv-import="uploadCsvImport"
            :upload-subsurface-import="uploadSubsurfaceImport"
            :current-locale="i18nLocale"
            :set-locale="setLocale"
            :theme-preference="themePreference"
            :resolved-theme="resolvedTheme"
            :set-theme-preference="setThemePreference"
          ></settings-view>
        </div>
      </div>
    </section>
    <nav
      class="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-primary/10 bg-surface-container-low/80 px-4 pb-6 pt-3 backdrop-blur-xl md:hidden"
    >
      <UButton
        v-for="item in mobileNavItems"
        :key="item.id"
        @click="setView(item.id)"
        :disabled="item.disabled"
        class="flex flex-col items-center justify-center rounded-lg px-3 py-1 transition-all disabled:cursor-not-allowed disabled:opacity-100"
        :class="
          item.disabled
            ? 'bg-tertiary/12 text-tertiary'
            : activeView === item.id ||
                ((activeView === 'imports' || activeView === 'edit' || activeView === 'create') && item.id === 'logs')
              ? 'bg-surface-container-high text-primary'
              : 'text-secondary/60'
        "
      >
        <span
          class="material-symbols-outlined mb-1"
          :style="
            !item.disabled &&
            (activeView === item.id ||
              ((activeView === 'imports' || activeView === 'edit' || activeView === 'create') && item.id === 'logs'))
              ? filledIconStyle
              : ''
          "
          >{{ item.mobileIcon || item.icon }}</span
        >
        <span class="font-label text-[10px] font-bold">{{ item.mobileLabel }}</span>
      </UButton>
    </nav>
    <div
      v-if="passwordDialogOpen"
      @click.self="closePasswordDialog"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-background/88 px-6 py-8 backdrop-blur-sm"
    >
      <div class="w-full max-w-md rounded-3xl border border-primary/10 bg-surface-container-low p-6 shadow-panel">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Account Security</p>
            <h3 class="mt-3 font-headline text-2xl font-bold tracking-tight text-on-surface">Change Password</h3>
            <p class="mt-3 text-sm leading-6 text-secondary">Update the password for your current DiveVault account.</p>
          </div>
          <UButton
            @click="closePasswordDialog"
            :disabled="passwordSubmitting"
            class="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/10 text-secondary transition-colors hover:bg-surface-container-high"
          >
            <span class="material-symbols-outlined text-lg">close</span>
          </UButton>
        </div>

        <p v-if="passwordStatus" class="mt-5 text-sm text-primary">{{ passwordStatus }}</p>
        <p v-if="passwordError" class="mt-5 text-sm text-error">{{ passwordError }}</p>

        <div class="mt-5 space-y-4">
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Current Password</span>
            <UInput
              v-model="passwordForm.currentPassword"
              type="password"
              class="w-full rounded-2xl border border-primary/15 bg-background/20 px-4 py-3 text-sm text-on-surface outline-none transition-colors focus:border-primary/40"
            />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">New Password</span>
            <UInput
              v-model="passwordForm.newPassword"
              type="password"
              class="w-full rounded-2xl border border-primary/15 bg-background/20 px-4 py-3 text-sm text-on-surface outline-none transition-colors focus:border-primary/40"
            />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Confirm New Password</span>
            <UInput
              v-model="passwordForm.confirmPassword"
              type="password"
              class="w-full rounded-2xl border border-primary/15 bg-background/20 px-4 py-3 text-sm text-on-surface outline-none transition-colors focus:border-primary/40"
            />
          </label>
        </div>

        <div class="mt-6 flex flex-wrap gap-3">
          <UButton
            @click="submitPasswordChange"
            :disabled="passwordSubmitting"
            class="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-on-primary transition-all hover:brightness-110"
          >
            {{ passwordSubmitting ? "Updating Password" : "Update Password" }}
          </UButton>
          <UButton
            @click="closePasswordDialog"
            :disabled="passwordSubmitting"
            class="inline-flex items-center justify-center rounded-xl border border-primary/15 px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-high"
          >
            Cancel
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
