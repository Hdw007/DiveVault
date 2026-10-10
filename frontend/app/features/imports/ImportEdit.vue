<script>
import DiveFormFields from "~/shared/components/dive-form/DiveFormFields.vue";
import {
  canCompleteImport,
  durationShort,
  filledIconStyle,
  formatDate,
  formatDateTime,
  formatDepthNumber,
  gasSummary,
  importCompletionPercent,
  isCommittedDive,
  missingImportFields,
  numberOrZero,
  paddedDiveIndex
} from "~/shared/utils/core.js";

export default {
  name: "DiveImportEditorView",
  components: {
    DiveFormFields
  },
  props: [
    "dive",
    "draft",
    "requiredLogbookFields",
    "diveSites",
    "buddies",
    "guides",
    "equipment",
    "defaultEquipmentIds",
    "equipmentSelectionEnabled",
    "savingImportId",
    "bulkImportSavePending",
    "deletingDiveId",
    "importError",
    "importStatusMessage",
    "updateImportDraft",
    "saveImportDraft",
    "deleteDive",
    "applyBuddyGuideToPendingImports",
    "createDiveSite",
    "backToQueue"
  ],
  computed: {
    selectedDraft() {
      return this.draft || null;
    },
    completionPercent() {
      return this.selectedDraft ? importCompletionPercent(this.selectedDraft, this.requiredLogbookFields) : 0;
    },
    isCommittedRecord() {
      return this.dive ? isCommittedDive(this.dive) : false;
    },
    missingFields() {
      return this.selectedDraft ? missingImportFields(this.selectedDraft, this.requiredLogbookFields) : [];
    },
    selectedGas() {
      return this.dive ? gasSummary(this.dive) : { label: "--", detail: "" };
    },
    saveLocked() {
      return this.bulkImportSavePending || this.isSaving || this.isDeleting;
    },
    isSaving() {
      return String(this.savingImportId) === String(this.dive?.id);
    },
    isDeleting() {
      return String(this.deletingDiveId) === String(this.dive?.id);
    }
  },
  methods: {
    t(key, fallback = key, params = {}) {
      return typeof this.$t === "function" ? this.$t(key, fallback, params) : fallback;
    },
    filledIconStyle,
    paddedDiveIndex,
    formatDateTime,
    durationShort,
    canCompleteImport(logbook) {
      return canCompleteImport(logbook, this.requiredLogbookFields);
    },
    updateField(key, value) {
      if (!this.dive) return;
      this.updateImportDraft(this.dive.id, key, value);
    },
    saveDraft(commit = false) {
      if (!this.dive) return;
      this.saveImportDraft(this.dive.id, commit);
    },
    applyBuddyGuide() {
      if (!this.dive) return;
      this.applyBuddyGuideToPendingImports(this.dive.id);
    },
    removeDive() {
      if (!this.dive) return;
      this.deleteDive(this.dive.id);
    },
    requiredChecklist(logbook) {
      const draft = logbook || {};
      const missingKeys = new Set(missingImportFields(draft, this.requiredLogbookFields).map((field) => field.key));
      return [
        {
          key: "site",
          label: this.t("Dive Site", "Dive Site"),
          value: draft.site || this.t("importEdit.required.site", "Required before logbook entry"),
          complete: !missingKeys.has("site"),
          icon: missingKeys.has("site") ? "location_off" : "task_alt"
        },
        {
          key: "buddy",
          label: this.t("Buddy", "Buddy"),
          value: draft.buddy || this.t("Optional", "Optional"),
          complete: true,
          icon: "task_alt"
        },
        {
          key: "guide",
          label: this.t("Guide", "Guide"),
          value: draft.guide || this.t("Optional", "Optional"),
          complete: true,
          icon: "task_alt"
        }
      ];
    },
    summaryCards(dive) {
      if (!dive) return [];
      return [
        { label: "Date", value: formatDate(dive.started_at) },
        { label: "Max Depth", value: `${formatDepthNumber(dive.max_depth_m)}m` },
        { label: "Duration", value: durationShort(dive.duration_seconds) },
        { label: "Gas", value: this.selectedGas.label, detail: this.selectedGas.detail }
      ];
    },
    durationMinutes(dive) {
      return Math.round(numberOrZero(dive?.duration_seconds) / 60);
    }
  }
};
</script>

<template>
  <section class="space-y-8 text-on-surface">
    <!-- Empty State -->
    <section v-if="!dive || !selectedDraft" class="space-y-4 bg-surface-container-low p-8 shadow-panel">
      <p class="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Imported Dive Missing</p>
      <h3 class="font-headline text-3xl font-bold tracking-tight">This imported dive is no longer in the queue.</h3>
      <UButton
        @click="backToQueue()"
        class="w-fit bg-primary px-5 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-primary"
      >
        Return To Queue
      </UButton>
    </section>

    <!-- Main View -->
    <template v-else>
      <!-- Header -->
      <header class="space-y-6">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <UButton
              @click="backToQueue()"
              class="inline-flex items-center gap-2 bg-surface-container-high px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface transition-colors hover:text-primary"
            >
              <span class="material-symbols-outlined text-sm">chevron_left</span>
              Imported Queue
            </UButton>
            <div class="mt-4 flex items-center gap-2 text-primary/60">
              <span class="material-symbols-outlined text-sm">edit_note</span>
              <span class="font-label text-[10px] font-bold uppercase tracking-[0.28em]">Imported Dive / Metadata Editor</span>
            </div>
            <h3 class="mt-2 font-headline text-5xl font-bold tracking-tight">Edit Imported Dive</h3>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div class="border border-primary/10 bg-surface-container-low px-5 py-4 text-center">
              <p class="font-headline text-3xl font-bold text-primary">{{ completionPercent }}%</p>
              <p class="mt-1 font-label text-[9px] font-bold uppercase tracking-[0.22em] text-secondary">Ready</p>
            </div>
            <div class="border border-primary/10 bg-surface-container-low px-5 py-4 text-center">
              <p class="font-headline text-3xl font-bold text-secondary">{{ durationMinutes(dive) }}</p>
              <p class="mt-1 font-label text-[9px] font-bold uppercase tracking-[0.22em] text-secondary">Minutes</p>
            </div>
            <div class="border border-tertiary/20 bg-surface-container-low px-5 py-4 text-center">
              <p class="font-headline text-3xl font-bold text-tertiary">{{ missingFields.length }}</p>
              <p class="mt-1 font-label text-[9px] font-bold uppercase tracking-[0.22em] text-secondary">Missing</p>
            </div>
          </div>
        </div>

        <!-- Telemetry Summary Hero -->
        <div class="relative overflow-hidden border border-primary/10 bg-surface-container-low p-8 shadow-panel">
          <div class="absolute right-0 top-0 h-48 w-48 bg-[radial-gradient(circle,rgba(156,202,255,0.14),transparent_68%)]"></div>
          <div class="absolute bottom-0 left-0 h-36 w-36 bg-[radial-gradient(circle,rgba(255,183,125,0.10),transparent_68%)]"></div>
          <div class="relative grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.9fr)] xl:items-end">
            <div>
              <div class="flex flex-wrap items-center gap-3">
                <span class="bg-tertiary/12 px-3 py-1 font-label text-[10px] font-bold uppercase tracking-[0.18em] text-tertiary">{{
                  isCommittedRecord ? "Logbook" : "Imported"
                }}</span>
                <span class="bg-background/35 px-3 py-1 font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">{{
                  paddedDiveIndex(dive)
                }}</span>
              </div>
              <h4 class="mt-4 font-headline text-4xl font-bold tracking-tight">{{ dive.vendor }} {{ dive.product }}</h4>
              <p class="mt-3 max-w-2xl text-sm leading-7 text-on-surface-variant">
                Telemetry was imported on {{ formatDateTime(dive.imported_at) }}.
                {{
                  isCommittedRecord
                    ? "Update the existing logbook metadata without changing the dive telemetry."
                    : "Complete the required registry metadata here and commit the dive into the permanent logbook when the record is ready."
                }}
              </p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div v-for="card in summaryCards(dive)" :key="card.label" class="border border-primary/10 bg-background/35 p-4">
                <p class="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-secondary/70">{{ card.label }}</p>
                <p class="mt-3 font-headline text-3xl font-bold leading-none">{{ card.value }}</p>
              </div>
            </div>
          </div>
        </div>

        <div v-if="importStatusMessage" class="border border-primary/20 bg-primary/10 px-5 py-4 text-sm text-primary shadow-panel">
          {{ importStatusMessage }}
        </div>
        <div v-if="importError" class="border border-error/20 bg-error-container/20 px-5 py-4 text-sm text-on-error-container shadow-panel">
          {{ importError }}
        </div>
      </header>

      <!-- Main Form & Sidebar Grid -->
      <div class="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <!-- Form Area -->
        <section class="space-y-6 border border-primary/10 bg-surface-container-low p-8 shadow-panel">
          <div>
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Metadata Entry</p>
            <h4 class="mt-2 font-headline text-3xl font-bold tracking-tight">Logbook Details</h4>
          </div>

          <!-- Unified Form Fields Component -->
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
            site-placeholder="Blue Hole / House Reef"
            textarea-rows="8"
            @update-field="updateField"
          />

          <!-- Batch Apply Buddy/Guide -->
          <div v-if="!isCommittedRecord" class="space-y-3 border border-primary/10 bg-surface-container-high/18 p-5">
            <div class="flex items-center justify-between gap-4">
              <span class="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Batch Update</span>
              <span class="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-tertiary">Buddy + Guide</span>
            </div>
            <p class="text-sm leading-6 text-on-surface-variant">
              Apply the current buddy and guide to every imported dive in the queue. Dive sites stay unique per record.
            </p>
            <UButton
              @click="applyBuddyGuide()"
              :disabled="bulkImportSavePending"
              class="w-full bg-surface-container-high px-5 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-primary transition-colors hover:bg-surface-container-highest disabled:opacity-50"
            >
              {{ bulkImportSavePending ? "Applying..." : "Apply Buddy + Guide To Imported Dives" }}
            </UButton>
          </div>

          <!-- Action Buttons -->
          <div v-if="!isCommittedRecord" class="grid grid-cols-2 gap-3">
            <UButton
              @click="saveDraft(false)"
              :disabled="saveLocked"
              class="bg-surface-container-high px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface transition-colors hover:text-primary disabled:opacity-50"
            >
              {{ bulkImportSavePending ? "Applying..." : isSaving ? "Saving..." : "Save Draft" }}
            </UButton>
            <UButton
              @click="saveDraft(true)"
              :disabled="saveLocked || !canCompleteImport(selectedDraft)"
              class="bg-primary px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-primary transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {{ bulkImportSavePending ? "Applying..." : isSaving ? "Saving..." : "Complete Record" }}
            </UButton>
          </div>
          <UButton
            v-if="!isCommittedRecord"
            @click="removeDive()"
            :disabled="saveLocked"
            class="w-full bg-error-container/20 px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-error-container transition-colors hover:bg-error-container/30 disabled:opacity-50"
          >
            {{ isDeleting ? "Removing..." : "Remove Imported Dive" }}
          </UButton>
          <UButton
            v-else
            @click="saveDraft(true)"
            :disabled="saveLocked || !canCompleteImport(selectedDraft)"
            class="w-full bg-primary px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-primary transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ isSaving ? "Saving..." : "Save Changes" }}
          </UButton>
        </section>

        <!-- Aside Readiness & Checklist Sidebar -->
        <aside class="space-y-6">
          <section class="border border-primary/10 bg-surface-container-low p-6 shadow-panel">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Readiness</p>
                <h4 class="mt-3 font-headline text-4xl font-bold">{{ completionPercent }}%</h4>
              </div>
              <span class="material-symbols-outlined text-2xl text-primary" :style="filledIconStyle">rule_settings</span>
            </div>
            <div class="mt-5 h-1 overflow-hidden bg-surface-container-high">
              <div class="h-full bg-gradient-to-r from-primary to-tertiary" :style="{ width: completionPercent + '%' }"></div>
            </div>
            <p class="mt-3 text-sm leading-6 text-on-surface-variant">Missing fields block commit but do not block draft saves.</p>
          </section>

          <section class="border border-primary/10 bg-surface-container-low p-6 shadow-panel">
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Required Checklist</p>
            <div class="mt-4 space-y-3">
              <div
                v-for="item in requiredChecklist(selectedDraft)"
                :key="item.key"
                class="flex items-center justify-between gap-3 border border-primary/10 bg-surface-container-high/30 px-4 py-3"
              >
                <div class="flex items-center gap-3">
                  <span class="material-symbols-outlined text-sm" :class="item.complete ? 'text-primary' : 'text-tertiary'">{{
                    item.icon
                  }}</span>
                  <div>
                    <p class="font-label text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">{{ item.label }}</p>
                    <p class="text-sm text-on-surface">{{ item.value }}</p>
                  </div>
                </div>
                <span
                  class="font-label text-[10px] font-bold uppercase tracking-[0.14em]"
                  :class="item.complete ? 'text-primary' : 'text-tertiary'"
                  >{{ item.complete ? "Ready" : "Missing" }}</span
                >
              </div>
            </div>
          </section>

          <section class="border border-primary/10 bg-surface-container-low p-6 shadow-panel">
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Imported Dive</p>
            <div class="mt-4 space-y-3 text-sm text-on-surface-variant">
              <p><span class="text-on-surface">Dive ID:</span> {{ paddedDiveIndex(dive) }}</p>
              <p><span class="text-on-surface">Started:</span> {{ formatDateTime(dive.started_at) }}</p>
              <p><span class="text-on-surface">Duration:</span> {{ durationShort(dive.duration_seconds) }}</p>
              <p><span class="text-on-surface">Device:</span> {{ dive.vendor }} {{ dive.product }}</p>
            </div>
          </section>
        </aside>
      </div>
    </template>
  </section>
</template>
