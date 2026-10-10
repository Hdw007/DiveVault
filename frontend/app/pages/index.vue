<script setup>
import DashboardView from "~/features/dashboard/Dashboard.vue";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useAppNavigation } from "~/shared/composables/use-app-navigation.js";
import { useAppShell } from "~/shared/composables/use-app-shell.js";

const divesStore = useDivesStore();
const profileStore = useProfileStore();
const { openDive, openImportQueue, setView } = useAppNavigation();
const shell = useAppShell();
</script>

<template>
  <DashboardView
    display-mode="dashboard"
    :dives="divesStore.committedDives"
    :all-dives="divesStore.dives"
    :dive-sites="profileStore.diveSites"
    :stats="divesStore.stats"
    :set-view="setView"
    :backend-healthy="divesStore.backendHealthy"
    :open-dive="openDive"
    :current-user-name="shell.currentUserName.value"
    :imported-dive-count="divesStore.importedDiveCount"
    :open-import-queue="openImportQueue"
  />
</template>
