<script setup>
import LogsView from "~/features/logbook/Logs.vue";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useAppNavigation } from "~/shared/composables/use-app-navigation.js";
import { useAppShell } from "~/shared/composables/use-app-shell.js";

const divesStore = useDivesStore();
const profileStore = useProfileStore();
const { openDive, openImportQueue, openManualDiveCreator } = useAppNavigation();
const shell = useAppShell();

function setSearchText(val) {
  divesStore.searchText = val;
}
</script>

<template>
  <LogsView
    :dives="divesStore.committedDives"
    :dive-sites="profileStore.diveSites"
    :logbook-display-fields="profileStore.logbookDisplayFields"
    :search-text="divesStore.searchText"
    :open-dive="openDive"
    :open-import-queue="openImportQueue"
    :open-manual-dive="openManualDiveCreator"
    :set-search-text="setSearchText"
    :delete-dive="shell.deleteDive"
    :deleting-dive-id="divesStore.deletingDiveId"
    :status-message="divesStore.importStatusMessage"
    :error-message="divesStore.importError"
  />
</template>
