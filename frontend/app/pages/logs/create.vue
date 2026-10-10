<script setup>
import { onMounted } from "vue";
import ManualDiveEntryView from "~/features/logbook/ManualDive.vue";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useEquipmentStore } from "~/shared/composables/use-equipment-store.js";
import { useAppNavigation } from "~/shared/composables/use-app-navigation.js";
import { useAppShell } from "~/shared/composables/use-app-shell.js";
import { createManualDiveDraft } from "~/shared/utils/dive-drafts.js";

const divesStore = useDivesStore();
const profileStore = useProfileStore();
const equipmentStore = useEquipmentStore();
const { closeManualDiveCreator } = useAppNavigation();
const shell = useAppShell();

onMounted(() => {
  divesStore.state.manualDiveDraft = createManualDiveDraft();
  divesStore.state.manualDiveCreating = false;
  divesStore.state.manualDiveError = "";
});

function updateManualDiveDraft(key, value) {
  divesStore.updateManualDiveDraft(key, value);
}

function createDiveSite(payload) {
  return profileStore.createDiveSite(payload, shell.apiClient());
}

async function searchDiveSiteLocation(query) {
  const payload = await profileStore.searchLocation(query, shell.apiClient());
  return payload?.found ? payload.result : null;
}
</script>

<template>
  <ManualDiveEntryView
    :draft="divesStore.manualDiveDraft"
    :required-logbook-fields="profileStore.requiredLogbookFields"
    :dive-sites="profileStore.diveSites"
    :buddies="profileStore.buddies"
    :guides="profileStore.guides"
    :equipment="equipmentStore.equipment"
    :default-equipment-ids="equipmentStore.defaultEquipmentIds"
    :equipment-selection-enabled="profileStore.equipmentSelectionEnabled"
    :creating="divesStore.manualDiveCreating"
    :error-message="divesStore.manualDiveError"
    :update-draft="updateManualDiveDraft"
    :create-manual-dive="shell.createManualDive"
    :close-creator="closeManualDiveCreator"
    :create-dive-site="createDiveSite"
    :search-dive-site-location="searchDiveSiteLocation"
  />
</template>
