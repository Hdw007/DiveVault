<script>
import { useSettingsModals } from "~/shared/composables/use-settings-modals.js";

export default {
  name: "SettingsCreateEntryModal",
  setup() {
    const modals = useSettingsModals();
    return {
      pendingCreation: modals.pendingCreation,
      pendingCreationDraft: modals.pendingCreationDraft,
      pendingCreationType: modals.pendingCreationType,
      pendingCreationError: modals.pendingCreationError,
      pendingCreationSubmitting: modals.pendingCreationSubmitting,
      pendingCreationLookupLoading: modals.pendingCreationLookupLoading,
      pendingCreationTitle: modals.pendingCreationTitle,
      pendingCreationSubmitLabel: modals.pendingCreationSubmitLabel,
      closeCreateModal: modals.closeCreateModal,
      confirmCreateModal: modals.confirmCreateModal,
      searchPendingDiveSiteLocation: modals.searchPendingDiveSiteLocation
    };
  }
};
</script>

<template>
  <div
    v-if="pendingCreation"
    @click.self="closeCreateModal"
    class="fixed inset-0 z-[55] flex items-center justify-center bg-background/88 px-6 py-8 backdrop-blur-sm"
  >
    <div class="settings-modal-card">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">New Entry</p>
          <h3 class="mt-3 font-headline text-2xl font-bold tracking-tight text-on-surface">{{ pendingCreationTitle }}</h3>
          <p class="mt-3 text-sm text-secondary">This entry stays out of the list until you save it here.</p>
        </div>
        <UButton
          type="button"
          @click="closeCreateModal"
          :disabled="pendingCreationSubmitting"
          class="settings-button settings-button-ghost"
        >
          Close
        </UButton>
      </div>

      <div v-if="pendingCreationError" class="settings-feedback mt-5 border-error/20 bg-error-container/20 text-on-error-container">
        {{ pendingCreationError }}
      </div>

      <div v-if="pendingCreationType === 'license'" class="settings-modal-grid mt-6">
        <label class="space-y-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Company</span>
          <UInput v-model="pendingCreationDraft.company" type="text" class="settings-input" placeholder="PADI / SSI / NAUI" />
        </label>
        <label class="space-y-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Certification Name</span>
          <UInput v-model="pendingCreationDraft.certification_name" type="text" class="settings-input" placeholder="Advanced Open Water" />
        </label>
        <label class="space-y-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Student Number</span>
          <UInput
            v-model="pendingCreationDraft.student_number"
            type="text"
            class="settings-input"
            placeholder="Student or certification number"
          />
        </label>
        <label class="space-y-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Certification Date</span>
          <UInput v-model="pendingCreationDraft.certification_date" type="text" class="settings-input" placeholder="YYYY-MM-DD" />
        </label>
        <label class="space-y-2 md:col-span-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Instructor Number</span>
          <UInput v-model="pendingCreationDraft.instructor_number" type="text" class="settings-input" placeholder="Instructor number" />
        </label>
        <div class="settings-side-panel md:col-span-2">
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">PDF Upload</p>
          <p class="mt-2 text-sm text-secondary">Save the license first. You can attach or replace the PDF from the saved license card.</p>
        </div>
      </div>

      <div v-else-if="pendingCreationType === 'dive-site'" class="settings-modal-section mt-6">
        <label class="space-y-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Site Name</span>
          <UInput v-model="pendingCreationDraft.name" type="text" class="settings-input" placeholder="North Wall / Training Reef" />
        </label>
        <div class="settings-side-panel settings-modal-subsection">
          <div class="settings-modal-section">
            <div class="settings-modal-header">
              <div>
                <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">GPS Lookup</p>
                <p class="settings-modal-copy mt-2 text-sm text-secondary">
                  Search from the location text, then adjust latitude and longitude if needed.
                </p>
              </div>
              <UButton
                type="button"
                @click="searchPendingDiveSiteLocation"
                :disabled="pendingCreationLookupLoading"
                class="settings-button settings-button-secondary settings-modal-lookup-button"
              >
                {{ pendingCreationLookupLoading ? "Searching GPS" : "Search GPS From Location" }}
              </UButton>
            </div>
            <label class="space-y-2">
              <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Location</span>
              <UInput v-model="pendingCreationDraft.location" type="text" class="settings-input" placeholder="Blue Hole, Dahab, Egypt" />
            </label>
            <div class="settings-modal-site-grid">
              <label class="space-y-2">
                <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Country</span>
                <UInput v-model="pendingCreationDraft.country" type="text" class="settings-input" placeholder="Egypt" />
              </label>
              <label class="space-y-2">
                <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Latitude</span>
                <UInput
                  v-model="pendingCreationDraft.latitude"
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  class="settings-input"
                  placeholder="25.1234"
                />
              </label>
              <label class="space-y-2">
                <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Longitude</span>
                <UInput
                  v-model="pendingCreationDraft.longitude"
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  class="settings-input"
                  placeholder="-80.4567"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="pendingCreationType === 'buddy'" class="settings-modal-grid mt-6">
        <label class="space-y-2 md:col-span-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Buddy Name</span>
          <UInput v-model="pendingCreationDraft.name" type="text" class="settings-input" placeholder="Sam Carter" />
        </label>
      </div>

      <div v-else-if="pendingCreationType === 'guide'" class="settings-modal-grid mt-6">
        <label class="space-y-2 md:col-span-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Guide Name</span>
          <UInput v-model="pendingCreationDraft.name" type="text" class="settings-input" placeholder="Kai Jensen" />
        </label>
      </div>

      <div class="settings-modal-actions">
        <UButton
          type="button"
          @click="closeCreateModal"
          :disabled="pendingCreationSubmitting"
          class="settings-button settings-button-ghost"
        >
          Cancel
        </UButton>
        <UButton
          type="button"
          @click="confirmCreateModal"
          :disabled="pendingCreationSubmitting"
          class="settings-button settings-button-primary"
        >
          {{ pendingCreationSubmitting ? "Saving..." : pendingCreationSubmitLabel }}
        </UButton>
      </div>
    </div>
  </div>
</template>
