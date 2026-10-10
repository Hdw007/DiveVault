<script>
import MetadataAutocompleteField from "~/shared/components/MetadataAutocomplete.vue";
import {
  TANK_VOLUME_OPTIONS,
  formatDiveSiteSuggestionDetail,
  groupEquipmentByCategory,
  normalizeFormDraft,
  resolveEquipmentStatus,
  siteCoordinateLabel
} from "~/shared/composables/use-dive-form.js";
import { equipmentTitle, normalizeName, serviceStatusForDive, sortNamedCollection } from "~/shared/utils/equipment-dive.js";

export default {
  name: "DiveFormFields",
  components: {
    MetadataAutocompleteField
  },
  props: {
    draft: {
      type: Object,
      required: true
    },
    diveSites: {
      type: Array,
      default: () => []
    },
    buddies: {
      type: Array,
      default: () => []
    },
    guides: {
      type: Array,
      default: () => []
    },
    equipment: {
      type: Array,
      default: () => []
    },
    defaultEquipmentIds: {
      type: Array,
      default: () => []
    },
    equipmentSelectionEnabled: {
      type: Boolean,
      default: true
    },
    startedAt: {
      type: String,
      default: ""
    },
    createDiveSite: {
      type: Function,
      default: null
    },
    customSiteCreationHandler: {
      type: Boolean,
      default: false
    },
    canEditTankPressure: {
      type: Boolean,
      default: true
    },
    sitePlaceholder: {
      type: String,
      default: "House Reef"
    },
    notesPlaceholder: {
      type: String,
      default: "Conditions, wildlife, route, entry, navigation, visibility..."
    },
    inputClass: {
      type: String,
      default:
        "w-full border border-primary/10 bg-background/35 px-4 py-3 text-sm text-on-surface placeholder:text-secondary/50 focus:border-primary/30 focus:ring-1 focus:ring-primary"
    },
    textareaRows: {
      type: [Number, String],
      default: 12
    }
  },
  emits: ["update-field", "update:draft", "create-site-click", "site-created"],
  data() {
    return {
      tankVolumeOptions: TANK_VOLUME_OPTIONS,
      diveSiteCreatePending: false,
      diveSiteCreateError: "",
      diveSiteCreateStatus: ""
    };
  },
  computed: {
    normalizedDraft() {
      return normalizeFormDraft(this.draft);
    },
    savedDiveSites() {
      return sortNamedCollection(this.diveSites);
    },
    savedBuddies() {
      return sortNamedCollection(this.buddies);
    },
    savedGuides() {
      return sortNamedCollection(this.guides);
    },
    selectedDiveSite() {
      const siteName = normalizeName(this.normalizedDraft.site);
      if (!siteName) return null;
      return this.savedDiveSites.find((site) => normalizeName(site.name) === siteName) || null;
    },
    canCreateDiveSite() {
      const siteName = typeof this.normalizedDraft.site === "string" ? this.normalizedDraft.site.trim() : "";
      return Boolean(siteName) && !this.selectedDiveSite && (this.customSiteCreationHandler || typeof this.createDiveSite === "function");
    },
    selectedEquipmentIds() {
      return this.normalizedDraft.equipment_ids;
    },
    equipmentGroups() {
      return groupEquipmentByCategory(this.equipment);
    },
    selectedEquipmentStatus() {
      return resolveEquipmentStatus(this.selectedEquipmentIds, this.equipment, this.startedAt);
    },
    invalidSelectedEquipment() {
      return this.selectedEquipmentStatus.filter((item) => item.status === "unknown" || item.status === "overdue");
    }
  },
  methods: {
    t(key, fallback = key, params = {}) {
      return typeof this.$t === "function" ? this.$t(key, fallback, params) : fallback;
    },
    formatDiveSiteSuggestionDetail,
    siteCoordinateLabel,
    equipmentTitle,
    serviceStatusForDive,
    updateField(key, value) {
      this.$emit("update-field", key, value);
      if (key === "site") {
        this.clearDiveSiteCreateFeedback();
      }
    },
    clearDiveSiteCreateFeedback() {
      this.diveSiteCreateError = "";
      this.diveSiteCreateStatus = "";
    },
    handleSaveDiveSiteClick() {
      if (this.customSiteCreationHandler) {
        this.$emit("create-site-click");
      } else {
        this.saveCurrentDiveSite();
      }
    },
    async saveCurrentDiveSite() {
      const siteName = typeof this.normalizedDraft.site === "string" ? this.normalizedDraft.site.trim() : "";
      if (!siteName || typeof this.createDiveSite !== "function") return;

      this.diveSiteCreatePending = true;
      this.diveSiteCreateError = "";
      this.diveSiteCreateStatus = "";
      try {
        const savedSite = await this.createDiveSite({ name: siteName });
        if (savedSite?.name && savedSite.name !== this.normalizedDraft.site) {
          this.updateField("site", savedSite.name);
        }
        this.diveSiteCreateStatus = `${savedSite?.name || siteName} added to your saved dive sites.`;
        this.$emit("site-created", savedSite);
      } catch (error) {
        this.diveSiteCreateError = error?.message || "Could not save the dive site.";
      } finally {
        this.diveSiteCreatePending = false;
      }
    },
    equipmentChecked(equipmentId) {
      return this.selectedEquipmentIds.includes(String(equipmentId));
    },
    equipmentWarning(item) {
      return ["unknown", "overdue"].includes(serviceStatusForDive(item, this.startedAt).status);
    },
    toggleEquipment(equipmentId) {
      const id = String(equipmentId);
      const nextIds = this.equipmentChecked(id)
        ? this.selectedEquipmentIds.filter((entry) => entry !== id)
        : [...this.selectedEquipmentIds, id];
      this.updateField("equipment_ids", nextIds);
    },
    useDefaultEquipment() {
      this.updateField("equipment_ids", Array.isArray(this.defaultEquipmentIds) ? [...this.defaultEquipmentIds] : []);
    },
    clearEquipment() {
      this.updateField("equipment_ids", []);
    }
  }
};
</script>

<template>
  <div class="space-y-6">
    <slot name="extra-top" />

    <!-- Registry & Core Metadata -->
    <div class="grid gap-6 md:grid-cols-2">
      <!-- Dive Site -->
      <label class="space-y-2">
        <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Dive Site</span>
        <metadata-autocomplete-field
          :model-value="normalizedDraft.site"
          @update:model-value="updateField('site', $event)"
          :options="savedDiveSites"
          :option-detail="formatDiveSiteSuggestionDetail"
          :placeholder="sitePlaceholder"
          :input-class="inputClass + ' pr-12'"
        />
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs leading-5 text-on-surface-variant">
            {{ siteCoordinateLabel(selectedDiveSite) }}
          </p>
          <UButton
            v-if="canCreateDiveSite"
            @click="handleSaveDiveSiteClick()"
            :disabled="diveSiteCreatePending"
            type="button"
            class="inline-flex items-center gap-2 bg-surface-container-high px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary disabled:opacity-50"
          >
            <span class="material-symbols-outlined text-sm">add_location_alt</span>
            {{ diveSiteCreatePending ? "Saving Dive Site..." : "Save As Reusable Dive Site" }}
          </UButton>
          <p v-if="diveSiteCreateStatus" class="w-full text-xs leading-5 text-primary">{{ diveSiteCreateStatus }}</p>
          <p v-if="diveSiteCreateError" class="w-full text-xs leading-5 text-on-error-container">{{ diveSiteCreateError }}</p>
        </div>
      </label>

      <!-- Buddy -->
      <label class="space-y-2">
        <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Buddy</span>
        <metadata-autocomplete-field
          :model-value="normalizedDraft.buddy"
          @update:model-value="updateField('buddy', $event)"
          :options="savedBuddies"
          placeholder="Buddy name"
          :input-class="inputClass + ' pr-12'"
        />
        <p class="text-xs leading-5 text-on-surface-variant">
          {{
            savedBuddies.length
              ? "Search saved buddies from Settings or enter a custom value."
              : "No saved buddies yet. Add them in Settings to reuse them here."
          }}
        </p>
      </label>

      <!-- Guide -->
      <label class="space-y-2">
        <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Guide</span>
        <metadata-autocomplete-field
          :model-value="normalizedDraft.guide"
          @update:model-value="updateField('guide', $event)"
          :options="savedGuides"
          placeholder="Guide or instructor"
          :input-class="inputClass + ' pr-12'"
        />
      </label>

      <!-- Tank Volume -->
      <label class="space-y-2">
        <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Tank Volume</span>
        <USelect
          :model-value="normalizedDraft.tank_volume_l || ''"
          :items="tankVolumeOptions"
          placeholder="Select tank volume"
          aria-label="Tank Volume"
          @update:model-value="updateField('tank_volume_l', $event)"
          :class="inputClass"
        />
      </label>

      <!-- Entry & Exit Pressure (Air Values) -->
      <template v-if="canEditTankPressure">
        <label class="space-y-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Entry Pressure</span>
          <UInput
            :value="normalizedDraft.begin_pressure_bar || ''"
            @input="updateField('begin_pressure_bar', $event.target.value)"
            type="number"
            min="0"
            max="400"
            step="1"
            placeholder="200"
            :class="'ui-number-input ' + inputClass"
          />
        </label>

        <label class="space-y-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Exit Pressure</span>
          <UInput
            :value="normalizedDraft.end_pressure_bar || ''"
            @input="updateField('end_pressure_bar', $event.target.value)"
            type="number"
            min="0"
            max="400"
            step="1"
            placeholder="70"
            :class="'ui-number-input ' + inputClass"
          />
        </label>
      </template>

      <!-- Weather Description -->
      <label class="space-y-2">
        <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">{{ t("Weather", "Weather") }}</span>
        <UInput
          :value="normalizedDraft.weather_description"
          @input="updateField('weather_description', $event.target.value)"
          type="text"
          :placeholder="t('logbookEdit.weather.placeholder', 'Sunny, overcast, surge on entry')"
          :class="inputClass"
        />
      </label>

      <!-- Visibility -->
      <label class="space-y-2">
        <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">{{ t("Visibility", "Visibility") }}</span>
        <UInput
          :value="normalizedDraft.visibility"
          @input="updateField('visibility', $event.target.value)"
          type="text"
          :placeholder="t('logbookEdit.visibility.placeholder', '15 m / moderate')"
          :class="inputClass"
        />
      </label>

      <!-- Wetsuit -->
      <label class="space-y-2">
        <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">{{ t("Wetsuit", "Wetsuit") }}</span>
        <UInput
          :value="normalizedDraft.wetsuit_description"
          @input="updateField('wetsuit_description', $event.target.value)"
          type="text"
          :placeholder="t('logbookEdit.wetsuit.placeholder', '7mm semi-dry')"
          :class="inputClass"
        />
      </label>

      <!-- Weights -->
      <label class="space-y-2">
        <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">{{ t("Weights", "Weights") }}</span>
        <UInput
          :value="normalizedDraft.weight_description"
          @input="updateField('weight_description', $event.target.value)"
          type="text"
          :placeholder="t('logbookEdit.weights.placeholder', '8 kg integrated + 1 kg trim')"
          :class="inputClass"
        />
      </label>
    </div>

    <!-- Equipment Selection Section -->
    <section v-if="equipmentSelectionEnabled" class="space-y-4 border border-primary/10 bg-surface-container-high/18 p-5">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Equipment Used</p>
          <p class="mt-2 text-sm leading-6" :class="invalidSelectedEquipment.length ? 'text-tertiary' : 'text-primary'">
            {{
              invalidSelectedEquipment.length
                ? "Selected gear has service warnings, but this dive can still be saved."
                : selectedEquipmentIds.length
                  ? "Selected gear will be attached to this dive."
                  : "No equipment selected for this dive."
            }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            @click="useDefaultEquipment()"
            type="button"
            class="bg-surface-container-high px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary"
          >
            Use Defaults
          </UButton>
          <UButton
            @click="clearEquipment()"
            type="button"
            class="bg-background/30 px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-secondary"
          >
            Clear
          </UButton>
        </div>
      </div>

      <div v-if="equipmentGroups.length" class="grid gap-4 lg:grid-cols-2">
        <div v-for="group in equipmentGroups" :key="'equipment-group-' + group.category" class="space-y-2">
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">{{ group.category }}</p>
          <UButton
            v-for="item in group.items"
            :key="'equipment-item-' + item.id"
            type="button"
            @click="toggleEquipment(item.id)"
            class="flex w-full items-center justify-between gap-3 border px-4 py-3 text-left transition-colors"
            :class="
              equipmentChecked(item.id)
                ? equipmentWarning(item)
                  ? 'border-tertiary/45 bg-tertiary/10 text-on-surface'
                  : 'border-primary/35 bg-primary/10 text-on-surface'
                : 'border-primary/10 bg-background/20 text-secondary hover:border-primary/25'
            "
          >
            <span>
              <span class="block text-sm font-semibold">{{ equipmentTitle(item) }}</span>
              <span class="mt-1 block text-xs" :class="equipmentWarning(item) ? 'text-tertiary' : 'text-primary'">
                {{ serviceStatusForDive(item, startedAt).label }}
              </span>
            </span>
            <span class="material-symbols-outlined text-base">
              {{ equipmentChecked(item.id) ? "check_circle" : "radio_button_unchecked" }}
            </span>
          </UButton>
        </div>
      </div>
      <p v-else class="text-sm leading-6 text-on-surface-variant">Add equipment in the Equipment section to reuse it here.</p>

      <div
        v-if="invalidSelectedEquipment.length"
        class="space-y-1 border border-tertiary/30 bg-tertiary/10 px-4 py-3 text-sm text-tertiary"
      >
        <p v-for="item in invalidSelectedEquipment" :key="'invalid-equipment-' + item.id">{{ item.name }}: {{ item.label }}</p>
      </div>
    </section>

    <!-- Notes Textarea -->
    <label class="block space-y-2">
      <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Dive Notes</span>
      <UTextarea
        :value="normalizedDraft.notes"
        @input="updateField('notes', $event.target.value)"
        :rows="textareaRows"
        :placeholder="notesPlaceholder"
        class="min-h-[16rem] w-full resize-y border border-primary/10 bg-surface-container-high/35 px-5 py-4 text-sm leading-7 text-on-surface placeholder:text-secondary/50 focus:border-primary/30 focus:ring-1 focus:ring-primary"
      />
    </label>

    <slot name="extra-bottom" />
  </div>
</template>
