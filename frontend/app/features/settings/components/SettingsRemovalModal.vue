<script>
import { useSettingsModals } from "~/shared/composables/use-settings-modals.js";

export default {
  name: "SettingsRemovalModal",
  setup() {
    const modals = useSettingsModals();
    return {
      pendingRemoval: modals.pendingRemoval,
      closeRemovalModal: modals.closeRemovalModal,
      confirmRemoval: modals.confirmRemoval
    };
  }
};
</script>

<template>
  <div
    v-if="pendingRemoval"
    @click.self="closeRemovalModal"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-background/88 px-6 py-8 backdrop-blur-sm"
  >
    <div class="settings-confirm-dialog">
      <div>
        <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Confirm Removal</p>
        <h3 class="mt-3 font-headline text-2xl font-bold tracking-tight text-on-surface">Remove {{ pendingRemoval.label }}?</h3>
        <p class="mt-3 text-sm text-secondary">This action cannot be undone.</p>
      </div>
      <div class="settings-confirm-actions">
        <UButton type="button" @click="closeRemovalModal" class="settings-button settings-button-ghost"> Cancel </UButton>
        <UButton type="button" @click="confirmRemoval" class="settings-button settings-button-danger"> Remove </UButton>
      </div>
    </div>
  </div>
</template>
