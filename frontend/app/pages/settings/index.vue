<script setup>
import SettingsView from "~/features/settings/Settings.vue";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useAppNavigation } from "~/shared/composables/use-app-navigation.js";
import { useAppShell } from "~/shared/composables/use-app-shell.js";
import { DEFAULT_SETTINGS_SECTION } from "~/routing/routes.js";

const divesStore = useDivesStore();
const profileStore = useProfileStore();
const { openImportQueue, setSettingsSection } = useAppNavigation();
const shell = useAppShell();

function handleProfileUpdated(payload) {
  profileStore.hydrateProfileState(payload);
}

function refreshDives() {
  return divesStore.fetchDives(shell.apiClient());
}

function uploadSubsurfaceImport(file, options = {}) {
  return divesStore.uploadSubsurfaceImport(file, options, shell.apiClient());
}
</script>

<template>
  <SettingsView
    cli-auth-code=""
    :active-section="DEFAULT_SETTINGS_SECTION"
    :set-active-section="setSettingsSection"
    :profile-updated="handleProfileUpdated"
    :refresh-dives="refreshDives"
    :open-import-queue="openImportQueue"
    :upload-csv-import="shell.uploadCsvImport"
    :upload-subsurface-import="uploadSubsurfaceImport"
    :current-locale="shell.preferences.currentLocale.value"
    :set-locale="shell.preferences.setLocale"
    :theme-preference="shell.preferences.themePreference.value"
    :resolved-theme="shell.preferences.resolvedTheme.value"
    :set-theme-preference="shell.preferences.setThemePreference"
  />
</template>
