<script setup>
import DiveImportView from "~/features/imports/Imports.vue";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useAppNavigation } from "~/shared/composables/use-app-navigation.js";
import { useAppShell } from "~/shared/composables/use-app-shell.js";

const divesStore = useDivesStore();
const profileStore = useProfileStore();
const { selectImportDive, setView } = useAppNavigation();
const shell = useAppShell();

function fetchDives() {
  return divesStore.fetchDives(shell.apiClient());
}
</script>

<template>
  <DiveImportView
    :dives="divesStore.dives"
    :import-drafts="divesStore.importDrafts"
    :required-logbook-fields="profileStore.requiredLogbookFields"
    :selected-import-id="divesStore.selectedImportId"
    :select-import-dive="selectImportDive"
    :deleting-dive-id="divesStore.deletingDiveId"
    :import-error="divesStore.importError"
    :import-status-message="divesStore.importStatusMessage"
    :delete-dive="shell.deleteDive"
    :set-view="setView"
    :fetch-dives="fetchDives"
  />
</template>
