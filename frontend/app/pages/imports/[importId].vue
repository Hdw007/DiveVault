<script setup>
import { computed, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "#app";
import DiveImportEditorView from "~/features/imports/ImportEdit.vue";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useEquipmentStore } from "~/shared/composables/use-equipment-store.js";
import { useAppNavigation } from "~/shared/composables/use-app-navigation.js";
import { useAppShell } from "~/shared/composables/use-app-shell.js";
import { singleRouteParam } from "~/routing/routes.js";

const route = useRoute();
const router = useRouter();
const divesStore = useDivesStore();
const profileStore = useProfileStore();
const equipmentStore = useEquipmentStore();
const { backToQueue } = useAppNavigation();
const shell = useAppShell();

const importId = computed(() => singleRouteParam(route.params.importId));

watch(
  importId,
  (newId) => {
    if (newId) {
      divesStore.selectedImportId = newId;
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  divesStore.selectedImportId = null;
});

watch([() => divesStore.isLoading, () => divesStore.dives], ([loading, dives]) => {
  if (!loading && dives.length > 0 && importId.value) {
    if (!divesStore.isPendingImportId(importId.value, dives, divesStore.importDrafts)) {
      router.replace("/imports");
    }
  }
});

function updateImportDraft(id, key, value) {
  divesStore.updateImportDraftField(id, key, value);
}

function applyBuddyGuideToPendingImports(id) {
  return divesStore.applyBuddyGuideToPending(id, shell.apiClient());
}

function createDiveSite(payload) {
  return profileStore.createDiveSite(payload, shell.apiClient());
}
</script>

<template>
  <DiveImportEditorView
    v-if="divesStore.selectedImportDive"
    :dive="divesStore.selectedImportDive"
    :draft="divesStore.selectedImportDraft"
    :required-logbook-fields="profileStore.requiredLogbookFields"
    :dive-sites="profileStore.diveSites"
    :buddies="profileStore.buddies"
    :guides="profileStore.guides"
    :equipment="equipmentStore.equipment"
    :default-equipment-ids="equipmentStore.defaultEquipmentIds"
    :equipment-selection-enabled="profileStore.equipmentSelectionEnabled"
    :saving-import-id="divesStore.savingImportId"
    :bulk-import-save-pending="divesStore.bulkImportSavePending"
    :deleting-dive-id="divesStore.deletingDiveId"
    :import-error="divesStore.importError"
    :import-status-message="divesStore.importStatusMessage"
    :update-import-draft="updateImportDraft"
    :save-import-draft="shell.saveImportDraft"
    :delete-dive="shell.deleteDive"
    :apply-buddy-guide-to-pending-imports="applyBuddyGuideToPendingImports"
    :create-dive-site="createDiveSite"
    :back-to-queue="backToQueue"
  />
</template>
