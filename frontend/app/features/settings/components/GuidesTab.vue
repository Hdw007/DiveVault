<script>
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useSettingsModals } from "~/shared/composables/use-settings-modals.js";
import { cloneGuides } from "~/shared/utils/settings-profile.js";

export default {
  name: "GuidesTab",
  setup() {
    const profileStore = useProfileStore();
    const modals = useSettingsModals();
    return {
      profileStore,
      modals
    };
  },
  data() {
    return {
      guideFilter: "",
      guideDrafts: [],
      editingGuideIds: []
    };
  },
  computed: {
    guides() {
      return this.profileStore.guides || [];
    },
    guidesSaving() {
      return this.profileStore.isSaving;
    },
    isInteractionLocked() {
      return this.profileStore.isLoading || this.profileStore.isSaving;
    },
    areGuidesEditing() {
      return this.editingGuideIds.length > 0;
    },
    visibleGuides() {
      const source = this.areGuidesEditing ? this.guideDrafts : this.guides;
      const filter = this.guideFilter.trim().toLowerCase();
      if (!filter) return source;
      return source.filter((guide) => (guide.name || "").toLowerCase().includes(filter));
    }
  },
  watch: {
    guides: {
      immediate: true,
      handler(nextGuides) {
        if (!this.areGuidesEditing) {
          this.guideDrafts = cloneGuides(nextGuides);
        }
      }
    }
  },
  methods: {
    addGuideEntry() {
      this.modals.openCreateModal("guide");
    },
    guideTitle(guide, index) {
      return guide.name?.trim() || `Guide ${index + 1}`;
    },
    isGuideEditing(guideId) {
      return this.editingGuideIds.includes(guideId);
    },
    editGuideItem(guideId) {
      this.guideDrafts = cloneGuides(this.guides);
      this.editingGuideIds = [guideId];
    },
    cancelGuidesEdit() {
      this.guideDrafts = cloneGuides(this.guides);
      this.editingGuideIds = [];
    },
    async saveGuides() {
      await this.profileStore.saveGuides(this.guideDrafts);
      this.editingGuideIds = [];
    },
    confirmRemoveGuideItem(guideId) {
      const guide = this.guideDrafts.find((g) => g.id === guideId) || this.guides.find((g) => g.id === guideId);
      const index = (this.areGuidesEditing ? this.guideDrafts : this.guides).findIndex((g) => g.id === guideId);
      const label = guide ? this.guideTitle(guide, index) : "this guide";

      this.modals.openRemovalModal({
        type: "guide",
        id: guideId,
        label,
        onConfirm: async () => {
          const nextGuides = this.guides.filter((g) => g.id !== guideId);
          await this.profileStore.saveGuides(nextGuides);
          this.cancelGuidesEdit();
        }
      });
    }
  }
};
</script>

<template>
  <div class="settings-panel settings-card">
    <div class="settings-card-header">
      <div>
        <p class="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Dive Guide</p>
        <h4 class="mt-2 font-headline text-3xl font-bold tracking-tight text-on-surface">Saved Guide List</h4>
        <p class="mt-3 max-w-3xl text-sm leading-7 text-secondary">
          Guides and instructors now use the same denser layout as buddies, which makes longer lists much easier to browse.
        </p>
      </div>
      <div class="settings-toolbar">
        <UButton @click="addGuideEntry" :disabled="isInteractionLocked" class="settings-button settings-button-secondary"
          >Add Guide</UButton
        >
      </div>
    </div>

    <label class="settings-filter-field mb-4">
      <span class="material-symbols-outlined text-[18px] text-secondary/70">search</span>
      <UInput v-model="guideFilter" type="text" class="settings-input" placeholder="Filter guides" />
    </label>

    <div v-if="!areGuidesEditing && guides.length === 0" class="settings-empty-state">
      <p class="font-headline text-lg font-bold">No saved guides</p>
      <p class="mt-2 text-sm text-secondary">
        Create a reusable guide list here so dive logs can search and reuse names instead of retyping them.
      </p>
    </div>

    <div v-else-if="areGuidesEditing && guideDrafts.length === 0" class="settings-empty-state">
      <p class="font-headline text-lg font-bold">No saved guides</p>
      <p class="mt-2 text-sm text-secondary">Add the first guide or instructor you want available in your logbook forms.</p>
    </div>

    <div v-else-if="visibleGuides.length === 0" class="settings-empty-state">
      <p class="font-headline text-lg font-bold">No matching guides</p>
      <p class="mt-2 text-sm text-secondary">Adjust the filter to see the rest of your saved guide list.</p>
    </div>

    <div v-else class="settings-compact-grid">
      <article v-for="(guide, index) in visibleGuides" :key="guide.id" class="settings-compact-card">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Guide {{ index + 1 }}</p>
            <h5 class="mt-2 font-headline text-xl font-bold text-on-surface">{{ guideTitle(guide, index) }}</h5>
          </div>
          <div class="settings-toolbar">
            <UButton v-if="!isGuideEditing(guide.id)" @click="editGuideItem(guide.id)" class="settings-button settings-button-secondary">
              Edit Guide
            </UButton>
            <UButton
              v-if="isGuideEditing(guide.id)"
              @click="confirmRemoveGuideItem(guide.id)"
              class="settings-button settings-button-danger"
              >Remove</UButton
            >
            <UButton
              v-if="isGuideEditing(guide.id)"
              @click="cancelGuidesEdit"
              :disabled="isInteractionLocked"
              class="settings-button settings-button-ghost"
              >Cancel</UButton
            >
            <UButton
              v-if="isGuideEditing(guide.id)"
              @click="saveGuides"
              :disabled="isInteractionLocked"
              class="settings-button settings-button-primary"
              >{{ guidesSaving ? "Saving Guide" : "Save Guide" }}</UButton
            >
          </div>
        </div>

        <div v-if="isGuideEditing(guide.id)" class="mt-5 space-y-3">
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Guide Name</span>
            <UInput v-model="guide.name" type="text" class="settings-input" placeholder="Kai Jensen" />
          </label>
        </div>
      </article>
    </div>
  </div>
</template>
