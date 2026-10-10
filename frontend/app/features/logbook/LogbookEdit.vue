<script>
import DiveFormFields from "~/shared/components/dive-form/DiveFormFields.vue";
import {
  buildDiveSequenceMap,
  canCompleteImport,
  diveDeviceLabel,
  durationShort,
  formatDate,
  formatDateTime,
  formatDepthNumber,
  formatTemperature,
  importTemperature,
  missingImportFields,
  paddedDiveIndex
} from "~/shared/utils/core.js";

export default {
  name: "LogbookEditorView",
  components: {
    DiveFormFields
  },
  props: [
    "dive",
    "allDives",
    "draft",
    "requiredLogbookFields",
    "diveSites",
    "buddies",
    "guides",
    "equipment",
    "defaultEquipmentIds",
    "equipmentSelectionEnabled",
    "savingImportId",
    "deletingDiveId",
    "statusMessage",
    "errorMessage",
    "updateDiveDraft",
    "saveDiveLogbook",
    "deleteDive",
    "createDiveSite",
    "closeEditor"
  ],
  computed: {
    selectedDraft() {
      return this.draft || null;
    },
    missingFields() {
      return this.selectedDraft ? missingImportFields(this.selectedDraft, this.requiredLogbookFields) : [];
    },
    isSaving() {
      return String(this.savingImportId) === String(this.dive?.id);
    },
    isDeleting() {
      return String(this.deletingDiveId) === String(this.dive?.id);
    },
    canSaveRecord() {
      return this.selectedDraft ? canCompleteImport(this.selectedDraft, this.requiredLogbookFields) : false;
    },
    stats() {
      if (!this.dive) return [];
      return [
        { label: "Date", value: formatDate(this.dive.started_at) },
        { label: "Depth", value: `${formatDepthNumber(this.dive.max_depth_m)}m` },
        { label: "Duration", value: durationShort(this.dive.duration_seconds) },
        { label: "Temperature", value: formatTemperature(importTemperature(this.dive)) }
      ];
    },
    diveSequenceMap() {
      return buildDiveSequenceMap(this.allDives);
    }
  },
  methods: {
    t(key, fallback = key, params = {}) {
      return typeof this.$t === "function" ? this.$t(key, fallback, params) : fallback;
    },
    formatDateTime,
    diveDeviceLabel,
    displayDiveIndex(dive) {
      return paddedDiveIndex(dive, this.diveSequenceMap);
    },
    updateField(key, value) {
      if (!this.dive) return;
      this.updateDiveDraft(this.dive.id, key, value);
    },
    saveChanges() {
      if (!this.dive) return;
      this.saveDiveLogbook(this.dive.id);
    },
    removeDive() {
      if (!this.dive) return;
      this.deleteDive(this.dive.id);
    }
  }
};
</script>

<template>
  <section v-if="dive && selectedDraft" class="space-y-8 text-on-surface">
    <header class="space-y-5">
      <UButton
        @click="closeEditor()"
        class="inline-flex items-center gap-2 bg-surface-container-high px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface transition-colors hover:text-primary"
      >
        <span class="material-symbols-outlined text-sm">arrow_back</span>
        Back To Dive Detail
      </UButton>
      <div>
        <section class="border border-primary/10 bg-surface-container-low p-8 shadow-panel">
          <div class="flex flex-wrap items-center gap-3">
            <span class="bg-primary/10 px-3 py-1 font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary"
              >Logbook Entry</span
            >
            <span class="bg-surface-container-high px-3 py-1 font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">{{
              displayDiveIndex(dive)
            }}</span>
          </div>
          <h3 class="mt-5 font-headline text-5xl font-bold tracking-tight">Edit Existing Dive</h3>
          <p class="mt-4 max-w-3xl text-sm leading-7 text-on-surface-variant">
            This view updates the permanent logbook metadata for an already saved dive. It does not use the import queue workflow and it
            does not affect other dives.
          </p>
          <div class="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div v-for="card in stats" :key="card.label" class="border border-primary/10 bg-surface-container-high/40 p-4">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">{{ card.label }}</p>
              <p class="mt-2 font-headline text-2xl font-bold">{{ card.value }}</p>
            </div>
          </div>
        </section>
      </div>
    </header>

    <div v-if="errorMessage" class="border border-error-container/40 bg-error-container/15 px-5 py-4 text-sm text-on-error-container">
      {{ errorMessage }}
    </div>
    <div v-if="statusMessage" class="border border-primary/20 bg-surface-container-high px-5 py-4 text-sm text-primary">
      {{ statusMessage }}
    </div>

    <section class="space-y-6 border border-primary/10 bg-surface-container-low p-8 shadow-panel">
      <!-- Unified Form Fields -->
      <dive-form-fields
        :draft="selectedDraft"
        :dive-sites="diveSites"
        :buddies="buddies"
        :guides="guides"
        :equipment="equipment"
        :default-equipment-ids="defaultEquipmentIds"
        :equipment-selection-enabled="equipmentSelectionEnabled"
        :started-at="dive.started_at"
        :create-dive-site="createDiveSite"
        :can-edit-tank-pressure="true"
        notes-placeholder="Conditions, wildlife, route, incidents, visibility, buoyancy notes..."
        textarea-rows="14"
        @update-field="updateField"
      />

      <section class="border border-primary/10 bg-surface-container-high/30 p-5">
        <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">
          {{ t("Record Summary", "Record Summary") }}
        </p>
        <div class="mt-4 grid gap-4 text-sm text-on-surface-variant md:grid-cols-2 xl:grid-cols-4">
          <div class="space-y-1">
            <p>{{ t("Dive ID", "Dive ID") }}</p>
            <p class="text-on-surface">{{ displayDiveIndex(dive) }}</p>
          </div>
          <div class="space-y-1">
            <p>{{ t("Started", "Started") }}</p>
            <p class="text-on-surface">{{ formatDateTime(dive.started_at) }}</p>
          </div>
          <div class="space-y-1">
            <p>Imported</p>
            <p class="text-on-surface">{{ formatDateTime(dive.imported_at) }}</p>
          </div>
          <div class="space-y-1">
            <p>{{ t("Device", "Device") }}</p>
            <p class="text-on-surface">{{ diveDeviceLabel(dive) }}</p>
          </div>
        </div>
      </section>

      <div class="flex flex-col gap-3 border-t border-primary/10 pt-6 sm:flex-row sm:justify-end">
        <UButton
          @click="closeEditor()"
          class="bg-surface-container-high px-5 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface transition-colors hover:text-primary"
        >
          Cancel
        </UButton>
        <UButton
          @click="removeDive()"
          :disabled="isSaving || isDeleting"
          aria-label="Remove dive"
          title="Remove dive"
          class="inline-flex h-11 w-11 items-center justify-center bg-surface-container-high text-on-error-container transition-colors hover:bg-error-container/30 disabled:opacity-50"
        >
          <span class="material-symbols-outlined text-[21px] leading-none">delete</span>
        </UButton>
        <UButton
          @click="saveChanges()"
          :disabled="isSaving || isDeleting || !canSaveRecord"
          class="bg-primary px-5 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-primary transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {{ isSaving ? "Saving..." : "Save Logbook Changes" }}
        </UButton>
      </div>
    </section>
  </section>
</template>
