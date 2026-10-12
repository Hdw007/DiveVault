<script setup>
import { computed, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "#app";
import DiveDetailView from "~/features/logbook/DiveDetail.vue";
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
const { closeDiveDetail, openDiveEditor } = useAppNavigation();
const shell = useAppShell();

const diveId = computed(() => singleRouteParam(route.params.diveId));

watch(
  diveId,
  (newId) => {
    if (newId) {
      divesStore.selectedDiveId = newId;
      divesStore.fetchDiveDetail(newId, shell.apiClient());
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (String(divesStore.selectedDiveId) === String(diveId.value)) {
    divesStore.selectedDiveId = null;
  }
});

watch([() => divesStore.isLoading, () => divesStore.dives], ([loading, dives]) => {
  if (!loading && dives.length > 0 && diveId.value) {
    const exists = dives.some((d) => String(d.id) === String(diveId.value));
    if (!exists) {
      router.replace("/logs");
    }
  }
});
</script>

<template>
  <DiveDetailView
    v-if="divesStore.selectedDive"
    :dive="divesStore.selectedDive"
    :all-dives="divesStore.dives"
    :dive-sites="profileStore.diveSites"
    :equipment="equipmentStore.equipment"
    :deleting-dive-id="divesStore.deletingDiveId"
    :close-detail="closeDiveDetail"
    :open-dive-editor="openDiveEditor"
    :delete-dive="shell.deleteDive"
  />
</template>
