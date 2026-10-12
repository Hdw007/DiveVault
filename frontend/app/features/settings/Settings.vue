<script>
import { useUser } from "~/shared/composables/auth.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { SETTINGS_SECTIONS } from "~/config/settings-sections.js";
import ApplicationSettingsTab from "~/features/settings/components/ApplicationSettingsTab.vue";
import BackupTab from "~/features/settings/components/BackupTab.vue";
import BuddiesTab from "~/features/settings/components/BuddiesTab.vue";
import DataManagementTab from "~/features/settings/components/DataManagementTab.vue";
import DiveSitesTab from "~/features/settings/components/DiveSitesTab.vue";
import DiverDetailsTab from "~/features/settings/components/DiverDetailsTab.vue";
import GuidesTab from "~/features/settings/components/GuidesTab.vue";
import UserManagementTab from "~/features/settings/components/UserManagementTab.vue";
import SettingsCreateEntryModal from "~/features/settings/components/SettingsCreateEntryModal.vue";
import SettingsRemovalModal from "~/features/settings/components/SettingsRemovalModal.vue";

export default {
  name: "SettingsView",
  components: {
    ApplicationSettingsTab,
    BackupTab,
    BuddiesTab,
    DataManagementTab,
    DiveSitesTab,
    DiverDetailsTab,
    GuidesTab,
    UserManagementTab,
    SettingsCreateEntryModal,
    SettingsRemovalModal
  },
  props: {
    activeSection: {
      type: String,
      default: () => SETTINGS_SECTIONS[0]?.id || "diver-details"
    },
    setActiveSection: {
      type: Function,
      default: null
    },
    profileUpdated: {
      type: Function,
      default: null
    },
    refreshDives: {
      type: Function,
      default: null
    },
    openImportQueue: {
      type: Function,
      default: null
    },
    uploadCsvImport: {
      type: Function,
      default: null
    },
    uploadSubsurfaceImport: {
      type: Function,
      default: null
    },
    currentLocale: {
      type: String,
      default: "en"
    },
    setLocale: {
      type: Function,
      default: null
    },
    themePreference: {
      type: String,
      default: "system"
    },
    resolvedTheme: {
      type: String,
      default: "dark"
    },
    setThemePreference: {
      type: Function,
      default: null
    }
  },
  setup() {
    const profileStore = useProfileStore();
    const { user } = useUser();

    return {
      profileStore,
      authUser: user
    };
  },
  computed: {
    profileLoading() {
      return this.profileStore.isLoading;
    },
    profileStatus() {
      return this.profileStore.statusMessage;
    },
    profileError() {
      return this.profileStore.error;
    },
    canManageUsers() {
      return this.authUser?.role === "admin" || Boolean(this.authUser?.isOwner);
    },
    activeSettingsSection() {
      return this.activeSection || SETTINGS_SECTIONS[0]?.id || "diver-details";
    },
    settingsSections() {
      return SETTINGS_SECTIONS.filter((section) => section.id !== "manage-users" || this.canManageUsers);
    },
    settingsOverviewStats() {
      const licenses = this.profileStore.licenses || [];
      const diveSites = this.profileStore.diveSites || [];
      const buddies = this.profileStore.buddies || [];
      const guides = this.profileStore.guides || [];

      return [
        { id: "licenses", label: "Certifications", value: licenses.length, icon: "badge" },
        { id: "diveSites", label: "Saved Sites", value: diveSites.length, icon: "location_on" },
        { id: "buddies", label: "Buddy Contacts", value: buddies.length, icon: "group" },
        { id: "guides", label: "Guides", value: guides.length, icon: "sports" }
      ];
    }
  },
  async mounted() {
    if (!this.profileStore.isLoaded) {
      await this.profileStore.fetchProfile().catch(() => {});
    }
  },
  methods: {
    selectSettingsSection(sectionId) {
      if (typeof this.setActiveSection === "function") {
        this.setActiveSection(sectionId);
      }
    }
  }
};
</script>

<template>
  <section class="dashboard-command-center text-on-surface">
    <header class="settings-stat-strip">
      <article v-for="stat in settingsOverviewStats" :key="stat.id" class="settings-stat-pill">
        <span class="material-symbols-outlined settings-stat-pill-icon">{{ stat.icon }}</span>
        <p class="settings-stat-pill-label">{{ stat.label }}</p>
        <div v-if="profileLoading" class="settings-loading-bar settings-loading-bar-stat"></div>
        <p v-else class="settings-stat-pill-value">{{ stat.value }}</p>
      </article>
    </header>

    <div v-if="profileStatus" class="settings-feedback border-primary/20 bg-primary/10 text-primary shadow-panel">{{ profileStatus }}</div>
    <div v-if="profileError" class="settings-feedback border-error/20 bg-error-container/20 text-on-error-container shadow-panel">
      {{ profileError }}
    </div>

    <div class="settings-mobile-nav settings-panel flex gap-3 overflow-x-auto p-3 md:hidden">
      <UButton
        v-for="section in settingsSections"
        :key="section.id"
        @click="selectSettingsSection(section.id)"
        class="min-w-[14rem] shrink-0 rounded-2xl border px-4 py-3 text-left transition-colors"
        :class="
          activeSettingsSection === section.id
            ? 'border-primary/30 bg-surface-container-high text-primary'
            : 'border-primary/10 bg-background/10 text-secondary'
        "
      >
        <div class="flex items-start gap-3">
          <span class="material-symbols-outlined mt-0.5 text-lg">{{ section.icon }}</span>
          <div>
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em]">{{ section.label }}</p>
            <p class="mt-2 text-xs leading-5 opacity-80">{{ section.description }}</p>
          </div>
        </div>
      </UButton>
    </div>

    <section class="settings-page-layout">
      <aside class="settings-section-nav settings-panel">
        <UButton
          v-for="section in settingsSections"
          :key="'desktop-settings-' + section.id"
          type="button"
          @click="selectSettingsSection(section.id)"
          class="settings-section-nav-item"
          :class="activeSettingsSection === section.id ? 'is-active' : ''"
        >
          <span class="material-symbols-outlined settings-section-nav-icon">{{ section.icon }}</span>
          <span class="min-w-0">
            <span class="settings-section-nav-label">{{ section.label }}</span>
            <span class="settings-section-nav-description">{{ section.description }}</span>
          </span>
        </UButton>
      </aside>

      <section class="settings-content">
        <div v-if="profileLoading" class="settings-panel settings-card settings-loading-state">
          <div>
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Loading</p>
            <h4 class="mt-2 font-headline text-3xl font-bold tracking-tight text-on-surface">Preparing Your Settings</h4>
            <p class="mt-3 max-w-3xl text-sm leading-7 text-secondary">
              Fetching licenses, dive sites, buddies, guides, and saved profile details.
            </p>
          </div>

          <div class="settings-loading-grid">
            <div class="settings-loading-card">
              <div class="settings-loading-bar settings-loading-bar-title"></div>
              <div class="settings-loading-bar settings-loading-bar-body"></div>
              <div class="settings-loading-bar settings-loading-bar-body settings-loading-bar-short"></div>
            </div>
            <div class="settings-loading-card">
              <div class="settings-loading-bar settings-loading-bar-title"></div>
              <div class="settings-loading-bar settings-loading-bar-body"></div>
              <div class="settings-loading-bar settings-loading-bar-body"></div>
            </div>
            <div class="settings-loading-card">
              <div class="settings-loading-bar settings-loading-bar-title"></div>
              <div class="settings-loading-bar settings-loading-bar-body"></div>
              <div class="settings-loading-bar settings-loading-bar-body settings-loading-bar-short"></div>
            </div>
          </div>
        </div>

        <template v-else>
          <diver-details-tab v-if="activeSettingsSection === 'diver-details'" />
          <application-settings-tab
            v-if="activeSettingsSection === 'application-settings'"
            :current-locale="currentLocale"
            :set-locale="setLocale"
            :theme-preference="themePreference"
            :resolved-theme="resolvedTheme"
            :set-theme-preference="setThemePreference"
          />
          <dive-sites-tab v-if="activeSettingsSection === 'dive-sites'" />
          <buddies-tab v-if="activeSettingsSection === 'buddies'" />
          <guides-tab v-if="activeSettingsSection === 'dive-guide'" />
          <data-management-tab
            v-if="activeSettingsSection === 'data-management'"
            :upload-csv-import="uploadCsvImport"
            :upload-subsurface-import="uploadSubsurfaceImport"
            :open-import-queue="openImportQueue"
            :refresh-dives="refreshDives"
          />
          <user-management-tab v-if="activeSettingsSection === 'manage-users' && canManageUsers" />
          <backup-tab v-if="activeSettingsSection === 'backup'" />
        </template>
      </section>
    </section>

    <settings-create-entry-modal />
    <settings-removal-modal />
  </section>
</template>
