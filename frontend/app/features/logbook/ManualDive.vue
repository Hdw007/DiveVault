<script>
import DiveFormFields from "~/shared/components/dive-form/DiveFormFields.vue";
import { TANK_VOLUME_OPTIONS, formatDiveSiteSuggestionDetail, validateDivePressures } from "~/shared/composables/use-dive-form.js";
import { logbookRequirementFieldOptions, missingImportFields } from "~/shared/utils/core.js";

const MANUAL_FIELD_MAP = {
  tank_volume_l: "tankVolumeL",
  begin_pressure_bar: "beginPressureBar",
  end_pressure_bar: "endPressureBar",
  weather_description: "weatherDescription",
  wetsuit_description: "wetsuitDescription",
  weight_description: "weightDescription"
};

function emptyDiveSiteDraft(name = "") {
  return {
    name,
    location: "",
    country: "",
    latitude: "",
    longitude: ""
  };
}

export default {
  name: "ManualDiveEntryView",
  components: {
    DiveFormFields
  },
  props: [
    "draft",
    "requiredLogbookFields",
    "diveSites",
    "buddies",
    "guides",
    "equipment",
    "defaultEquipmentIds",
    "equipmentSelectionEnabled",
    "creating",
    "errorMessage",
    "updateDraft",
    "createManualDive",
    "closeCreator",
    "createDiveSite",
    "searchDiveSiteLocation"
  ],
  data() {
    return {
      pendingDiveSiteDraft: null,
      pendingDiveSiteLookupLoading: false,
      pendingDiveSiteSubmitting: false,
      diveSiteCreateError: "",
      diveSiteCreateStatus: ""
    };
  },
  computed: {
    pendingDiveSiteCreationOpen() {
      return Boolean(this.pendingDiveSiteDraft);
    },
    draftDateTime() {
      const date = String(this.draft?.date || "").trim();
      const time = String(this.draft?.time || "").trim() || "00:00";
      return date ? `${date}T${time}` : "";
    },
    validationItems() {
      const issues = [];
      const durationMinutes = Number.parseFloat(this.draft?.durationMinutes);
      const maxDepthM = Number.parseFloat(this.draft?.maxDepthM);
      const temperatureValue = typeof this.draft?.temperatureC === "string" ? this.draft.temperatureC.trim() : "";
      const temperatureC = temperatureValue ? Number.parseFloat(temperatureValue) : null;
      const tankVolumeValue = typeof this.draft?.tankVolumeL === "string" ? this.draft.tankVolumeL.trim() : "";
      const beginPressureValue = typeof this.draft?.beginPressureBar === "string" ? this.draft.beginPressureBar.trim() : "";
      const endPressureValue = typeof this.draft?.endPressureBar === "string" ? this.draft.endPressureBar.trim() : "";

      if (!String(this.draft?.date || "").trim()) issues.push("Start date is required.");
      if (!String(this.draft?.time || "").trim()) issues.push("Start time is required.");
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) issues.push("Duration must be greater than zero.");
      if (!Number.isFinite(maxDepthM) || maxDepthM < 0) issues.push("Max depth must be zero or greater.");
      if (temperatureValue && !Number.isFinite(temperatureC)) issues.push("Temperature must be a valid number.");
      if (tankVolumeValue && !TANK_VOLUME_OPTIONS.some((option) => option.value === tankVolumeValue))
        issues.push("Tank volume must be 9L, 12L, or 15L.");
      issues.push(...validateDivePressures(beginPressureValue, endPressureValue));
      for (const field of missingImportFields(
        {
          site: this.draft?.site,
          buddy: this.draft?.buddy,
          guide: this.draft?.guide,
          weather_description: this.draft?.weatherDescription,
          visibility: this.draft?.visibility,
          wetsuit_description: this.draft?.wetsuitDescription,
          weight_description: this.draft?.weightDescription,
          notes: this.draft?.notes
        },
        this.requiredLogbookFields
      )) {
        const option = logbookRequirementFieldOptions.find((entry) => entry.key === field.key) || field;
        issues.push(`${option.label} is required.`);
      }
      return issues;
    },
    canSubmit() {
      return this.validationItems.length === 0;
    }
  },
  methods: {
    formatDiveSiteSuggestionDetail,
    updateField(key, value) {
      if (typeof this.updateDraft !== "function") return;
      const mappedKey = MANUAL_FIELD_MAP[key] || key;
      this.updateDraft(mappedKey, value);
      if (mappedKey !== key) {
        this.updateDraft(key, value);
      }
    },
    openDiveSiteCreateDialog() {
      const siteName = typeof this.draft?.site === "string" ? this.draft.site.trim() : "";
      if (!siteName) return;
      this.pendingDiveSiteDraft = emptyDiveSiteDraft(siteName);
      this.pendingDiveSiteLookupLoading = false;
      this.pendingDiveSiteSubmitting = false;
      this.diveSiteCreateError = "";
      this.diveSiteCreateStatus = "";
    },
    closeDiveSiteCreateDialog() {
      if (this.pendingDiveSiteSubmitting) return;
      this.pendingDiveSiteDraft = null;
      this.pendingDiveSiteLookupLoading = false;
      this.diveSiteCreateError = "";
    },
    validatePendingDiveSite() {
      const draft = this.pendingDiveSiteDraft;
      if (!draft) return "Nothing to save.";
      if (!String(draft.name || "").trim()) {
        return "Enter a site name before saving the dive site.";
      }
      return "";
    },
    async searchPendingDiveSiteGps() {
      const draft = this.pendingDiveSiteDraft;
      if (!draft || typeof this.searchDiveSiteLocation !== "function") return;
      const query = typeof draft.location === "string" ? draft.location.trim() : "";
      if (!query) {
        this.diveSiteCreateError = "Enter a location before searching for GPS coordinates.";
        return;
      }

      this.pendingDiveSiteLookupLoading = true;
      this.diveSiteCreateError = "";
      try {
        const result = await this.searchDiveSiteLocation(query);
        if (!result) {
          this.diveSiteCreateError = `No coordinates found for "${query}".`;
          return;
        }

        this.pendingDiveSiteDraft = {
          ...draft,
          country: typeof result.country === "string" ? result.country : draft.country,
          latitude: String(result.latitude),
          longitude: String(result.longitude)
        };
      } catch (error) {
        this.diveSiteCreateError = error?.message || "Could not search for GPS coordinates.";
      } finally {
        this.pendingDiveSiteLookupLoading = false;
      }
    },
    async saveCurrentDiveSite() {
      if (!this.pendingDiveSiteDraft || typeof this.createDiveSite !== "function") return;

      const validationError = this.validatePendingDiveSite();
      if (validationError) {
        this.diveSiteCreateError = validationError;
        return;
      }

      this.pendingDiveSiteSubmitting = true;
      this.diveSiteCreateError = "";
      this.diveSiteCreateStatus = "";
      try {
        const savedSite = await this.createDiveSite({
          name: String(this.pendingDiveSiteDraft.name || "").trim(),
          location: String(this.pendingDiveSiteDraft.location || "").trim(),
          country: String(this.pendingDiveSiteDraft.country || "").trim(),
          latitude: this.pendingDiveSiteDraft.latitude === "" ? null : Number.parseFloat(this.pendingDiveSiteDraft.latitude),
          longitude: this.pendingDiveSiteDraft.longitude === "" ? null : Number.parseFloat(this.pendingDiveSiteDraft.longitude)
        });
        if (savedSite?.name && savedSite.name !== this.draft?.site) {
          this.updateField("site", savedSite.name);
        }
        this.diveSiteCreateStatus = `${savedSite?.name || this.pendingDiveSiteDraft.name} added to your saved dive sites.`;
        this.pendingDiveSiteDraft = null;
      } catch (error) {
        this.diveSiteCreateError = error?.message || "Could not save the dive site.";
      } finally {
        this.pendingDiveSiteSubmitting = false;
      }
    },
    submitForm() {
      if (!this.canSubmit || typeof this.createManualDive !== "function") return;
      this.createManualDive();
    }
  }
};
</script>

<template>
  <section class="space-y-8 text-on-surface">
    <header class="space-y-5">
      <UButton
        @click="closeCreator()"
        class="inline-flex items-center gap-2 bg-surface-container-high px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface transition-colors hover:text-primary"
      >
        <span class="material-symbols-outlined text-sm">arrow_back</span>
        Back To Logs
      </UButton>
      <section class="border border-primary/10 bg-surface-container-low p-8 shadow-panel">
        <div class="flex flex-wrap items-center gap-3">
          <span class="bg-primary/10 px-3 py-1 font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary"
            >Manual Entry</span
          >
          <span class="bg-surface-container-high px-3 py-1 font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary"
            >No Dive Computer Required</span
          >
        </div>
        <h3 class="mt-5 font-headline text-5xl font-bold tracking-tight">Manual Dive Entry</h3>
        <p class="mt-4 max-w-3xl text-sm leading-7 text-on-surface-variant">
          Create a dive log directly in DiveVault when no dive computer was used. The import queue remains reserved for dives brought in
          through the DiveVault importer tool.
        </p>
      </section>
      <div v-if="errorMessage" class="border border-error/20 bg-error-container/20 px-5 py-4 text-sm text-on-error-container shadow-panel">
        {{ errorMessage }}
      </div>
    </header>

    <form @submit.prevent="submitForm" class="space-y-6">
      <section class="space-y-6 border border-primary/10 bg-surface-container-low p-8 shadow-panel">
        <div>
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Dive Basics</p>
          <h4 class="mt-2 font-headline text-3xl font-bold tracking-tight">Manual Log Details</h4>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Date</span>
            <UInput
              :value="draft.date"
              @input="updateField('date', $event.target.value)"
              type="date"
              class="w-full border border-primary/10 bg-background/35 px-4 py-3 text-sm text-on-surface focus:border-primary/30 focus:ring-1 focus:ring-primary"
            />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Start Time</span>
            <UInput
              :value="draft.time"
              @input="updateField('time', $event.target.value)"
              type="time"
              class="w-full border border-primary/10 bg-background/35 px-4 py-3 text-sm text-on-surface focus:border-primary/30 focus:ring-1 focus:ring-primary"
            />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Duration</span>
            <UInput
              :value="draft.durationMinutes"
              @input="updateField('durationMinutes', $event.target.value)"
              type="number"
              min="1"
              step="1"
              placeholder="45"
              class="ui-number-input w-full border border-primary/10 bg-background/35 px-4 py-3 text-sm text-on-surface placeholder:text-secondary/50 focus:border-primary/30 focus:ring-1 focus:ring-primary"
            />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Max Depth</span>
            <UInput
              :value="draft.maxDepthM"
              @input="updateField('maxDepthM', $event.target.value)"
              type="number"
              min="0"
              step="0.1"
              placeholder="18.0"
              class="ui-number-input w-full border border-primary/10 bg-background/35 px-4 py-3 text-sm text-on-surface placeholder:text-secondary/50 focus:border-primary/30 focus:ring-1 focus:ring-primary"
            />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Water Temperature</span>
            <UInput
              :value="draft.temperatureC"
              @input="updateField('temperatureC', $event.target.value)"
              type="number"
              step="0.1"
              placeholder="27"
              class="ui-number-input w-full border border-primary/10 bg-background/35 px-4 py-3 text-sm text-on-surface placeholder:text-secondary/50 focus:border-primary/30 focus:ring-1 focus:ring-primary"
            />
          </label>
        </div>

        <!-- Unified Dive Form Fields -->
        <dive-form-fields
          :draft="draft"
          :dive-sites="diveSites"
          :buddies="buddies"
          :guides="guides"
          :equipment="equipment"
          :default-equipment-ids="defaultEquipmentIds"
          :equipment-selection-enabled="equipmentSelectionEnabled"
          :started-at="draftDateTime"
          :create-dive-site="createDiveSite"
          :custom-site-creation-handler="true"
          :can-edit-tank-pressure="true"
          site-placeholder="House Reef"
          notes-placeholder="Conditions, wildlife, route, entry, navigation, visibility..."
          textarea-rows="12"
          @update-field="updateField"
          @create-site-click="openDiveSiteCreateDialog"
        />

        <div v-if="diveSiteCreateStatus || diveSiteCreateError" class="space-y-2">
          <p v-if="diveSiteCreateStatus" class="text-xs leading-5 text-primary">{{ diveSiteCreateStatus }}</p>
          <p v-if="diveSiteCreateError" class="text-xs leading-5 text-on-error-container">{{ diveSiteCreateError }}</p>
        </div>
      </section>

      <section class="space-y-6 border border-primary/10 bg-surface-container-low p-6 shadow-panel">
        <div>
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Create Entry</p>
          <h4 class="mt-2 font-headline text-3xl font-bold tracking-tight">Ready To Save</h4>
          <p class="mt-3 text-sm leading-6 text-on-surface-variant">
            Saving creates a complete dive log entry immediately and skips the importer staging workflow.
          </p>
        </div>

        <div class="space-y-3">
          <div
            v-for="issue in validationItems"
            :key="issue"
            class="flex items-center gap-3 border border-error/20 bg-error-container/10 px-4 py-3"
          >
            <span class="material-symbols-outlined text-sm text-tertiary">warning</span>
            <span class="text-sm text-on-surface">{{ issue }}</span>
          </div>
          <div v-if="!validationItems.length" class="flex items-center gap-3 border border-primary/20 bg-primary/10 px-4 py-3">
            <span class="material-symbols-outlined text-sm text-primary">task_alt</span>
            <span class="text-sm text-on-surface">The manual dive can be created immediately.</span>
          </div>
        </div>

        <div class="space-y-3">
          <UButton
            type="submit"
            :disabled="creating || !canSubmit"
            class="w-full bg-primary px-5 py-4 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-primary transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ creating ? "Creating Dive Log..." : "Create Dive Log" }}
          </UButton>
          <UButton
            type="button"
            @click="closeCreator()"
            :disabled="creating"
            class="w-full bg-surface-container-high px-5 py-4 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface transition-colors hover:text-primary disabled:opacity-50"
          >
            Cancel
          </UButton>
        </div>
      </section>
    </form>

    <!-- Modal for GPS-enabled dive site creation -->
    <div
      v-if="pendingDiveSiteCreationOpen"
      @click.self="closeDiveSiteCreateDialog"
      class="fixed inset-0 z-[55] flex items-center justify-center bg-background/88 px-6 py-8 backdrop-blur-sm"
    >
      <div class="settings-modal-card">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">New Entry</p>
            <h3 class="mt-3 font-headline text-2xl font-bold tracking-tight text-on-surface">Add Dive Site</h3>
            <p class="mt-3 text-sm text-secondary">This entry stays out of the list until you save it here.</p>
          </div>
          <UButton
            type="button"
            @click="closeDiveSiteCreateDialog"
            :disabled="pendingDiveSiteSubmitting"
            class="settings-button settings-button-ghost"
          >
            Close
          </UButton>
        </div>

        <div v-if="diveSiteCreateError" class="settings-feedback mt-5 border-error/20 bg-error-container/20 text-on-error-container">
          {{ diveSiteCreateError }}
        </div>

        <div class="settings-modal-section mt-6">
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Site Name</span>
            <UInput v-model="pendingDiveSiteDraft.name" type="text" class="settings-input" placeholder="North Wall / Training Reef" />
          </label>
          <div class="settings-side-panel settings-modal-subsection">
            <div class="settings-modal-section">
              <div class="settings-modal-header">
                <div>
                  <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">GPS Lookup</p>
                  <p class="settings-label mt-1 text-secondary">Search the geographic service for latitude and longitude.</p>
                </div>
                <UButton
                  type="button"
                  @click="searchPendingDiveSiteGps"
                  :disabled="pendingDiveSiteLookupLoading"
                  class="settings-button settings-button-secondary"
                >
                  <span class="material-symbols-outlined text-sm">travel_explore</span>
                  {{ pendingDiveSiteLookupLoading ? "Searching..." : "Search GPS From Location" }}
                </UButton>
              </div>
              <label class="space-y-2">
                <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Location</span>
                <UInput v-model="pendingDiveSiteDraft.location" type="text" class="settings-input" placeholder="Blue Hole, Dahab, Egypt" />
              </label>
            </div>
            <div class="settings-modal-grid">
              <label class="space-y-2">
                <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Country</span>
                <UInput v-model="pendingDiveSiteDraft.country" type="text" class="settings-input" placeholder="Egypt" />
              </label>
              <label class="space-y-2">
                <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Latitude</span>
                <UInput v-model="pendingDiveSiteDraft.latitude" type="number" step="0.000001" class="settings-input" placeholder="28.572" />
              </label>
              <label class="space-y-2">
                <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Longitude</span>
                <UInput
                  v-model="pendingDiveSiteDraft.longitude"
                  type="number"
                  step="0.000001"
                  class="settings-input"
                  placeholder="34.538"
                />
              </label>
            </div>
          </div>
        </div>

        <div class="mt-8 flex justify-end gap-3">
          <UButton
            type="button"
            @click="closeDiveSiteCreateDialog"
            :disabled="pendingDiveSiteSubmitting"
            class="settings-button settings-button-secondary"
          >
            Cancel
          </UButton>
          <UButton
            type="button"
            @click="saveCurrentDiveSite"
            :disabled="pendingDiveSiteSubmitting"
            class="settings-button settings-button-primary"
          >
            {{ pendingDiveSiteSubmitting ? "Saving..." : "Save Dive Site" }}
          </UButton>
        </div>
      </div>
    </div>
  </section>
</template>
