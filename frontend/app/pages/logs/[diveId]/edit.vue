<script setup>
import { computed, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "#app";
import LogbookEditorView from "~/features/logbook/LogbookEdit.vue";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useEquipmentStore } from "~/shared/composables/use-equipment-store.js";
import { useAppNavigation } from "~/shared/composables/use-app-navigation.js";
import { useAppShell } from "~/shared/composables/use-app-shell.js";
import { isCommittedDive } from "~/shared/utils/core.js";
import { singleRouteParam } from "~/routing/routes.js";

const route = useRoute();
const router = useRouter();
const divesStore = useDivesStore();
const profileStore = useProfileStore();
const equipmentStore = useEquipmentStore();
const { closeDiveEditor } = useAppNavigation();
const shell = useAppShell();

const diveId = computed(() => singleRouteParam(route.params.diveId));

watch(
  diveId,
  (newId) => {
    if (newId) {
      divesStore.selectedEditDiveId = newId;
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (String(divesStore.selectedEditDiveId) === String(diveId.value)) {
    divesStore.selectedEditDiveId = null;
  }
});

watch([() => divesStore.isLoading, () => divesStore.dives], ([loading, dives]) => {
  if (!loading && dives.length > 0 && diveId.value) {
    const dive = dives.find((d) => String(d.id) === String(diveId.value));
    if (!dive || !isCommittedDive(dive)) {
      router.replace("/logs");
    }
  }
});

function updateDiveDraft(id, key, value) {
  divesStore.updateImportDraftField(id, key, value);
}

function createDiveSite(payload) {
  return profileStore.createDiveSite(payload, shell.apiClient());
}
</script>

<template>
  <LogbookEditorView
    v-if="divesStore.selectedEditDive"
    :dive="divesStore.selectedEditDive"
    :all-dives="divesStore.dives"
    :draft="divesStore.selectedEditDraft"
    :required-logbook-fields="profileStore.requiredLogbookFields"
    :dive-sites="profileStore.diveSites"
    :buddies="profileStore.buddies"
    :guides="profileStore.guides"
    :equipment="equipmentStore.equipment"
    :default-equipment-ids="equipmentStore.defaultEquipmentIds"
    :equipment-selection-enabled="profileStore.equipmentSelectionEnabled"
    :saving-import-id="divesStore.savingImportId"
    :deleting-dive-id="divesStore.deletingDiveId"
    :status-message="divesStore.importStatusMessage"
    :error-message="divesStore.importError"
    :update-dive-draft="updateDiveDraft"
    :save-dive-logbook="shell.saveExistingDiveLogbook"
    :delete-dive="shell.deleteDive"
    :create-dive-site="createDiveSite"
    :close-editor="() => closeDiveEditor(diveId)"
  />
</template>
