<script>
import { defineAsyncComponent } from "vue";
import { createApiClient } from "~/shared/api/client.js";
import { useAuth, useUser } from "~/shared/composables/auth.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";
import { useSettingsModals } from "~/shared/composables/use-settings-modals.js";
import {
  MAX_LICENSE_BYTES,
  cloneLicenses,
  formatBytes,
  formatSettingsDateTime as formatDateTime
} from "~/shared/utils/settings-profile.js";

const LicensePdfPreview = defineAsyncComponent(() => import("~/shared/components/LicensePdfPreview.vue"));

export default {
  name: "DiverDetailsTab",
  components: {
    LicensePdfPreview
  },
  setup() {
    const profileStore = useProfileStore();
    const modals = useSettingsModals();
    const { user } = useUser();
    const { getToken } = useAuth();
    const apiClient = createApiClient({ getToken: () => getToken({ skipCache: true }) });
    const authenticatedFetch = (res, opts) => apiClient.request(res, opts);

    return {
      profileStore,
      modals,
      authUser: user,
      authenticatedFetch
    };
  },
  data() {
    return {
      isProfileEditing: false,
      profileDraft: {
        name: "",
        email: ""
      },
      licenseFilter: "",
      licenseDrafts: [],
      editingLicenseIds: [],
      expandedLicenseIds: [],
      activeLicenseDocument: null,
      activeLicensePreview: null,
      pendingLicenseUploadId: null
    };
  },
  computed: {
    settingsProfile() {
      return this.profileStore.profile || {};
    },
    currentUserName() {
      return this.authUser?.first_name || this.settingsProfile.name || "";
    },
    currentUserEmail() {
      return this.authUser?.email || this.settingsProfile.email || "";
    },
    profileSaving() {
      return this.profileStore.isSaving;
    },
    isInteractionLocked() {
      return this.profileStore.isLoading || this.profileStore.isSaving;
    },
    hasUnsavedProfileChanges() {
      const initialName = this.settingsProfile.name || this.currentUserName;
      const initialEmail = this.settingsProfile.email || this.currentUserEmail;
      return this.profileDraft.name !== initialName || this.profileDraft.email !== initialEmail;
    },
    licenses() {
      return this.profileStore.licenses || [];
    },
    licensesSaving() {
      return this.profileStore.isSaving;
    },
    areLicensesEditing() {
      return this.editingLicenseIds.length > 0;
    },
    visibleLicenses() {
      const source = this.areLicensesEditing ? this.licenseDrafts : this.licenses;
      const filter = this.licenseFilter.trim().toLowerCase();
      if (!filter) return source;
      return source.filter(
        (license) =>
          (license.company || "").toLowerCase().includes(filter) ||
          (license.certification_name || "").toLowerCase().includes(filter) ||
          (license.student_number || "").toLowerCase().includes(filter)
      );
    }
  },
  watch: {
    licenses: {
      immediate: true,
      handler(nextLicenses) {
        if (!this.areLicensesEditing) {
          this.licenseDrafts = cloneLicenses(nextLicenses);
        }
      }
    }
  },
  methods: {
    formatBytes,
    formatDateTime,
    displayValue(value, fallback = "—") {
      return value ? String(value).trim() || fallback : fallback;
    },
    beginProfileEdit() {
      this.profileStore.clearStatus();
      this.profileDraft = {
        name: this.settingsProfile.name || this.currentUserName,
        email: this.settingsProfile.email || this.currentUserEmail
      };
      this.isProfileEditing = true;
    },
    cancelProfileEdit() {
      this.profileDraft = {
        name: this.settingsProfile.name || this.currentUserName,
        email: this.settingsProfile.email || this.currentUserEmail
      };
      this.isProfileEditing = false;
    },
    async saveProfile() {
      await this.profileStore.saveProfileDetails(this.profileDraft);
      this.isProfileEditing = false;
    },
    addLicenseEntry() {
      this.modals.openCreateModal("license");
    },
    licenseTitle(license, index) {
      return license.certification_name?.trim() || license.company?.trim() || `License ${index + 1}`;
    },
    isLicenseEditing(licenseId) {
      return this.editingLicenseIds.includes(licenseId);
    },
    isLicenseExpanded(licenseId) {
      return this.expandedLicenseIds.includes(licenseId);
    },
    editLicenseItem(licenseId) {
      this.licenseDrafts = cloneLicenses(this.licenses);
      this.editingLicenseIds = [licenseId];
      if (!this.expandedLicenseIds.includes(licenseId)) {
        this.expandedLicenseIds = [...this.expandedLicenseIds, licenseId];
      }
    },
    cancelLicensesEdit() {
      this.licenseDrafts = cloneLicenses(this.licenses);
      this.editingLicenseIds = [];
    },
    async saveLicenses() {
      await this.profileStore.saveLicenses(this.licenseDrafts);
      this.editingLicenseIds = [];
    },
    confirmRemoveLicenseItem(licenseId) {
      const license = this.licenseDrafts.find((l) => l.id === licenseId) || this.licenses.find((l) => l.id === licenseId);
      const index = (this.areLicensesEditing ? this.licenseDrafts : this.licenses).findIndex((l) => l.id === licenseId);
      const label = license ? this.licenseTitle(license, index) : "this license";

      this.modals.openRemovalModal({
        type: "license",
        id: licenseId,
        label,
        onConfirm: async () => {
          const nextLicenses = this.licenses.filter((l) => l.id !== licenseId);
          await this.profileStore.saveLicenses(nextLicenses);
          this.cancelLicensesEdit();
        }
      });
    },
    licenseExistsOnServer(licenseId) {
      return this.licenses.some((license) => license.id === licenseId);
    },
    isUploadingLicense(licenseId) {
      return this.profileStore.licenseUploadingId === licenseId;
    },
    triggerLicensePicker(licenseId) {
      this.profileStore.clearStatus();
      if (!this.areLicensesEditing) {
        this.profileStore.state.error = "Open license editing before uploading a PDF.";
        return;
      }
      if (!this.licenseExistsOnServer(licenseId)) {
        this.profileStore.state.error = "Save the license list before uploading a PDF for a new entry.";
        return;
      }
      this.pendingLicenseUploadId = licenseId;
      this.$refs.licenseInput?.inputRef?.click();
    },
    async handleLicenseSelection(event) {
      const file = event?.target?.files?.[0];
      if (event?.target) {
        event.target.value = "";
      }
      const licenseId = this.pendingLicenseUploadId;
      this.pendingLicenseUploadId = null;
      if (!file || !licenseId) return;

      if (file.size > MAX_LICENSE_BYTES) {
        this.profileStore.state.error = "License PDF must be 10 MB or smaller.";
        return;
      }
      await this.profileStore.uploadLicense(licenseId, file);
    },
    viewLicensePdf(license) {
      if (!license?.pdf?.preview_url) return;
      this.activeLicenseDocument = license;
      this.profileStore.clearStatus();
    },
    closeLicenseDocument() {
      this.activeLicenseDocument = null;
      this.activeLicensePreview = null;
    },
    openLicensePreview(page) {
      this.activeLicensePreview = {
        image: page.image,
        filename: this.activeLicenseDocument?.pdf?.filename || "License PDF",
        pageNumber: page.pageNumber || 1
      };
    },
    closeLicensePreview() {
      this.activeLicensePreview = null;
    }
  }
};
</script>

<template>
  <div class="settings-panel settings-card">
    <div class="mb-8 rounded-2xl border border-primary/15 bg-surface-container-low p-6">
      <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div class="max-w-3xl">
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Diver Profile</p>
          <h4 class="mt-2 font-headline text-3xl font-bold tracking-tight text-on-surface">Diver Details</h4>
          <p class="mt-3 text-sm leading-7 text-secondary">
            Keep the public-facing diver identity separate from application behavior and instance settings.
          </p>
        </div>
        <div class="settings-toolbar">
          <UButton
            v-if="!isProfileEditing"
            @click="beginProfileEdit"
            :disabled="isInteractionLocked"
            class="settings-button settings-button-secondary"
            >Edit Diver</UButton
          >
          <UButton
            v-if="isProfileEditing"
            @click="cancelProfileEdit"
            :disabled="isInteractionLocked"
            class="settings-button settings-button-ghost"
            >Cancel</UButton
          >
          <UButton
            v-if="isProfileEditing"
            @click="saveProfile"
            :disabled="isInteractionLocked || !hasUnsavedProfileChanges"
            class="settings-button settings-button-primary"
          >
            {{ profileSaving ? "Saving Diver" : "Save Diver" }}
          </UButton>
        </div>
      </div>

      <div v-if="isProfileEditing" class="settings-form-grid mt-6">
        <label class="space-y-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Name</span>
          <UInput v-model="profileDraft.name" type="text" class="settings-input" placeholder="Alex Diver" />
        </label>
        <label class="space-y-2">
          <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Email</span>
          <UInput v-model="profileDraft.email" type="email" class="settings-input" placeholder="diver@example.com" />
        </label>
      </div>

      <div v-else class="settings-detail-grid mt-6">
        <div class="settings-info-card">
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Name</p>
          <p class="mt-2 text-base font-semibold text-on-surface">{{ displayValue(settingsProfile.name || currentUserName) }}</p>
        </div>
        <div class="settings-info-card">
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Email</p>
          <p class="mt-2 text-base font-semibold text-on-surface">{{ displayValue(settingsProfile.email || currentUserEmail) }}</p>
        </div>
      </div>
    </div>

    <div class="settings-card-header">
      <div>
        <p class="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Diving Licenses</p>
        <h4 class="mt-2 font-headline text-3xl font-bold tracking-tight text-on-surface">Certifications And PDFs</h4>
        <p class="mt-3 max-w-3xl text-sm leading-7 text-secondary">
          Certificates stay compact until opened, so the saved list is easier to scan and the attached PDFs are still one click away.
        </p>
      </div>
      <div class="settings-toolbar">
        <UButton @click="addLicenseEntry" :disabled="isInteractionLocked" class="settings-button settings-button-secondary"
          >Add License</UButton
        >
      </div>
    </div>

    <label class="settings-filter-field mb-4">
      <span class="material-symbols-outlined text-[18px] text-secondary/70">search</span>
      <UInput v-model="licenseFilter" type="text" class="settings-input" placeholder="Filter licenses" />
    </label>

    <div v-if="!areLicensesEditing && licenses.length === 0" class="settings-empty-state">
      <p class="font-headline text-lg font-bold">No saved licenses</p>
      <p class="mt-2 text-sm text-secondary">Use Add License to create your first certification entry and attach its PDF.</p>
    </div>

    <div v-else-if="areLicensesEditing && licenseDrafts.length === 0" class="settings-empty-state">
      <p class="font-headline text-lg font-bold">No saved licenses</p>
      <p class="mt-2 text-sm text-secondary">Add your first certification entry to build a reusable license list.</p>
    </div>

    <div v-else-if="visibleLicenses.length === 0" class="settings-empty-state">
      <p class="font-headline text-lg font-bold">No matching licenses</p>
      <p class="mt-2 text-sm text-secondary">Adjust the filter to see the rest of your certification list.</p>
    </div>

    <div v-else class="space-y-4">
      <article v-for="(license, index) in visibleLicenses" :key="license.id" class="settings-item-card">
        <div class="settings-item-header">
          <div class="min-w-0">
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">License {{ index + 1 }}</p>
            <h5 class="mt-2 font-headline text-2xl font-bold tracking-tight text-on-surface">{{ licenseTitle(license, index) }}</h5>
            <div class="settings-chip-row mt-3">
              <span class="settings-chip">{{ displayValue(license.company, "Company pending") }}</span>
              <span class="settings-chip" :class="license.pdf ? 'is-accent' : ''">{{ license.pdf ? "PDF attached" : "No PDF" }}</span>
            </div>
          </div>

          <div class="settings-toolbar">
            <UButton v-if="license.pdf" @click="viewLicensePdf(license)" class="settings-button settings-button-secondary">
              View PDF
            </UButton>
            <UButton
              v-if="!isLicenseEditing(license.id)"
              @click="editLicenseItem(license.id)"
              class="settings-button settings-button-secondary"
            >
              Edit License
            </UButton>
            <UButton
              v-if="isLicenseEditing(license.id)"
              @click="confirmRemoveLicenseItem(license.id)"
              class="settings-button settings-button-danger"
            >
              Remove
            </UButton>
            <UButton
              v-if="isLicenseEditing(license.id)"
              @click="cancelLicensesEdit"
              :disabled="isInteractionLocked"
              class="settings-button settings-button-ghost"
            >
              Cancel
            </UButton>
            <UButton
              v-if="isLicenseEditing(license.id)"
              @click="saveLicenses"
              :disabled="isInteractionLocked"
              class="settings-button settings-button-primary"
            >
              {{ licensesSaving ? "Saving License" : "Save License" }}
            </UButton>
          </div>
        </div>

        <div v-if="isLicenseEditing(license.id) || isLicenseExpanded(license.id)" class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div v-if="isLicenseEditing(license.id)" class="settings-form-grid">
            <label class="space-y-2">
              <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Company</span>
              <UInput v-model="license.company" type="text" class="settings-input" placeholder="PADI / SSI / NAUI" />
            </label>
            <label class="space-y-2">
              <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Certification Name</span>
              <UInput v-model="license.certification_name" type="text" class="settings-input" placeholder="Advanced Open Water" />
            </label>
            <label class="space-y-2">
              <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Student Number</span>
              <UInput v-model="license.student_number" type="text" class="settings-input" placeholder="Student or certification number" />
            </label>
            <label class="space-y-2">
              <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Certification Date</span>
              <UInput v-model="license.certification_date" type="text" class="settings-input" placeholder="YYYY-MM-DD" />
            </label>
            <label class="space-y-2 md:col-span-2">
              <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Instructor Number</span>
              <UInput v-model="license.instructor_number" type="text" class="settings-input" placeholder="Instructor number" />
            </label>
          </div>

          <div v-else class="settings-detail-grid">
            <div class="settings-info-card">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Company</p>
              <p class="mt-2 text-base font-semibold text-on-surface">{{ displayValue(license.company) }}</p>
            </div>
            <div class="settings-info-card">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Certification</p>
              <p class="mt-2 text-base font-semibold text-on-surface">{{ displayValue(license.certification_name) }}</p>
            </div>
            <div class="settings-info-card">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Student Number</p>
              <p class="mt-2 text-base font-semibold text-on-surface">{{ displayValue(license.student_number) }}</p>
            </div>
            <div class="settings-info-card">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Certification Date</p>
              <p class="mt-2 text-base font-semibold text-on-surface">{{ displayValue(license.certification_date) }}</p>
            </div>
            <div class="settings-info-card md:col-span-2">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Instructor Number</p>
              <p class="mt-2 text-base font-semibold text-on-surface">{{ displayValue(license.instructor_number) }}</p>
            </div>
          </div>

          <div class="settings-side-panel">
            <div class="flex items-center justify-between gap-3">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">License PDF</p>
              <UButton
                v-if="isLicenseEditing(license.id)"
                @click="triggerLicensePicker(license.id)"
                :disabled="isUploadingLicense(license.id)"
                class="settings-button settings-button-secondary"
              >
                {{ isUploadingLicense(license.id) ? "Uploading..." : license.pdf ? "Replace PDF" : "Upload PDF" }}
              </UButton>
            </div>

            <div v-if="license.pdf" class="space-y-3">
              <div class="settings-file-meta">
                <p class="font-semibold text-on-surface">{{ license.pdf.filename }}</p>
                <p class="mt-1 text-sm text-secondary">
                  {{ formatBytes(license.pdf.size_bytes) }} &middot; Uploaded {{ formatDateTime(license.pdf.uploaded_at) }}
                </p>
              </div>
              <UButton type="button" @click="viewLicensePdf(license)" class="settings-button settings-button-secondary">
                Open PDF Preview
              </UButton>
            </div>

            <div v-else class="settings-empty-state">
              <p class="font-headline text-base font-bold">No PDF attached</p>
              <p class="mt-2 text-sm text-secondary">
                {{
                  isLicenseEditing(license.id)
                    ? "Upload the certification PDF for this specific license entry."
                    : "Open the license and switch to edit mode to attach a PDF."
                }}
              </p>
            </div>

            <p
              v-if="isLicenseEditing(license.id) && !licenseExistsOnServer(license.id)"
              class="text-[10px] uppercase tracking-[0.14em] text-secondary/70"
            >
              Save this new license before uploading its PDF.
            </p>
          </div>
        </div>
      </article>
    </div>

    <UInput ref="licenseInput" @change="handleLicenseSelection" type="file" accept="application/pdf,.pdf" class="hidden" />

    <div
      v-if="activeLicenseDocument"
      @click.self="closeLicenseDocument"
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/90 px-6 py-8 backdrop-blur-sm"
    >
      <div class="relative max-h-full w-full max-w-5xl overflow-auto border border-primary/15 bg-surface-container-low p-4 shadow-panel">
        <div class="mb-4 flex items-start justify-between gap-4">
          <div>
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">License PDF</p>
            <p class="mt-1 text-sm text-secondary">{{ activeLicenseDocument.pdf?.filename || "License PDF" }}</p>
          </div>
          <UButton type="button" @click="closeLicenseDocument" class="settings-button settings-button-secondary"> Close </UButton>
        </div>
        <license-pdf-preview
          :pdf="activeLicenseDocument.pdf"
          :authenticated-fetch="authenticatedFetch"
          @open-preview="openLicensePreview($event)"
        />
      </div>
    </div>

    <div
      v-if="activeLicensePreview"
      @click.self="closeLicensePreview"
      class="fixed inset-0 z-[55] flex items-center justify-center bg-background/90 px-6 py-8 backdrop-blur-sm"
    >
      <div class="relative max-h-full w-full max-w-5xl overflow-auto border border-primary/15 bg-surface-container-low p-4 shadow-panel">
        <div class="mb-4 flex items-start justify-between gap-4">
          <div>
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">License Preview</p>
            <p class="mt-1 text-sm text-secondary">{{ activeLicensePreview.filename }} - Page {{ activeLicensePreview.pageNumber }}</p>
          </div>
          <UButton type="button" @click="closeLicensePreview" class="settings-button settings-button-secondary"> Close </UButton>
        </div>
        <img
          :src="activeLicensePreview.image"
          :alt="activeLicensePreview.filename"
          class="mx-auto max-h-[80vh] w-auto max-w-full bg-white"
        />
      </div>
    </div>
  </div>
</template>
