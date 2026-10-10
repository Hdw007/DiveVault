<script setup>
import EquipmentView from "~/features/equipment/Equipment.vue";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useEquipmentStore } from "~/shared/composables/use-equipment-store.js";
import { useAppShell } from "~/shared/composables/use-app-shell.js";

const divesStore = useDivesStore();
const equipmentStore = useEquipmentStore();
const shell = useAppShell();

function setSearchText(val) {
  divesStore.searchText = val;
}

function saveEquipment(equipment) {
  return equipmentStore.saveEquipment(equipment, shell.apiClient());
}
</script>

<template>
  <EquipmentView
    :equipment="equipmentStore.equipment"
    :search-text="divesStore.searchText"
    :set-search-text="setSearchText"
    :saving="equipmentStore.isSaving"
    :status-message="equipmentStore.statusMessage"
    :error-message="equipmentStore.error"
    :save-equipment="saveEquipment"
  />
</template>
