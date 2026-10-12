<script setup>
import { computed } from "vue";
import { useRoute } from "#app";
import SettingsView from "~/features/settings/Settings.vue";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useAppNavigation } from "~/shared/composables/use-app-navigation.js";
import { useAppShell } from "~/shared/composables/use-app-shell.js";
import { singleRouteParam } from "~/routing/routes.js";

const route = useRoute();
const divesStore = useDivesStore();
const profileStore = useProfileStore();
const { openImportQueue, setSettingsSection } = useAppNavigation();
const shell = useAppShell();

const rawSection = computed(() => singleRouteParam(route.params.section) || "");
const activeSection = computed(() => shell.normalizeSettingsSection(rawSection.value));

function handleProfileUpdated(payload) {
  profileStore.hydrateProfileState(payload);
  refreshDives();
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
    :active-section="activeSection"
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
