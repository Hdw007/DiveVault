<script>
import { createApiClient } from "~/shared/api/client.js";
import { useAuth } from "~/shared/composables/auth.js";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { duplicateImportWarning } from "~/shared/utils/settings-profile.js";
import DiveComputerImportModal from "~/shared/components/DiveComputerImportModal.vue";

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

function filenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback;
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match ? decodeURIComponent(match[1]) : fallback;
}

export default {
  name: "DataManagementTab",
  components: {
    DiveComputerImportModal
  },
  props: {
    cliAuthCode: {
      type: String,
      default: ""
    },
    uploadCsvImport: {
      type: Function,
      default: null
    },
    uploadSubsurfaceImport: {
      type: Function,
      default: null
    },
    openImportQueue: {
      type: Function,
      default: null
    },
    refreshDives: {
      type: Function,
      default: null
    }
  },
  setup() {
    const divesStore = useDivesStore();
    const { getToken } = useAuth();
    const apiClient = createApiClient({ getToken: () => getToken({ skipCache: true }) });
    const authenticatedFetch = (res, opts) => apiClient.request(res, opts);

    return {
      divesStore,
      authGetToken: getToken,
      authenticatedFetch
    };
  },
  data() {
    return {
      dataManagementAction: "",
      dataManagementStatus: "",
      dataManagementWarning: "",
      dataManagementError: "",
      desktopSyncApproving: false,
      desktopSyncStatus: "",
      desktopSyncError: "",
      importReadyForReview: false,
      importPreview: null,
      pendingImportFile: null,
      pendingImportKind: "",
      showDiveComputerModal: false
    };
  },
  computed: {
    hasCliAuthCode() {
      return Boolean(this.cliAuthCode);
    },
    isDataManagementBusy() {
      return Boolean(this.dataManagementAction);
    },
    isInteractionLocked() {
      return this.isDataManagementBusy || this.desktopSyncApproving;
    },
    canConfirmImportPreview() {
      return Boolean(this.importPreview && !this.isDataManagementBusy && Number(this.importPreview.valid_rows || 0) > 0);
    }
  },
  methods: {
    duplicateImportWarning,
    resetDataManagementFeedback() {
      this.dataManagementStatus = "";
      this.dataManagementWarning = "";
      this.dataManagementError = "";
      this.importReadyForReview = false;
    },
    importKindLabel(kind) {
      return kind === "subsurface" ? "Subsurface export" : "CSV file";
    },
    normalizedImportPreview(payload, kind, file) {
      const summary = payload?.summary || payload || {};
      const rows = Array.isArray(summary.dives) ? summary.dives : [];
      return {
        ...summary,
        kind,
        label: this.importKindLabel(kind),
        fileName: file?.name || "",
        rows: Number(summary.rows || rows.length || 0),
        valid_rows: Number(summary.valid_rows || 0),
        invalid_rows: Number(summary.invalid_rows || 0),
        ready_rows: Number(summary.ready_rows || 0),
        duplicates: Number(summary.duplicates || 0),
        dives: rows
      };
    },
    importPreviewStatusLabel(row) {
      if (!row?.valid) return "Invalid";
      if (row?.status === "inserted") return "Imported";
      if (row?.duplicate) return "Duplicate";
      return "Ready";
    },
    importPreviewStatusClass(row) {
      if (!row?.valid) return "border-error/25 bg-error-container/20 text-on-error-container";
      if (row?.duplicate) return "border-tertiary/30 bg-tertiary/10 text-tertiary";
      return "border-primary/25 bg-primary/10 text-primary";
    },
    importResultStatus(payload, label) {
      const inserted = Number(payload?.inserted ?? 0);
      const rows = Number(payload?.rows ?? 0);
      const duplicates = Number(payload?.duplicates ?? 0);
      if (inserted <= 0 && duplicates > 0) {
        return `No new dives were added from this ${label}.`;
      }
      return `${label} import complete. ${inserted} new dives added from ${rows} dive${rows === 1 ? "" : "s"}; ${duplicates} duplicate dive${duplicates === 1 ? "" : "s"} skipped. Next step: review the imported dives and complete their logbook fields.`;
    },
    displayValue(value, fallback = "Not provided") {
      return value ? value : fallback;
    },
    reviewImportQueue() {
      if (typeof this.openImportQueue === "function") {
        this.openImportQueue();
      }
    },
    async exportDownload(endpoint, fallbackFilename, actionLabel, successMessage) {
      this.dataManagementAction = actionLabel;
      this.resetDataManagementFeedback();
      try {
        const response = await this.authenticatedFetch(endpoint);
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }
        const blob = await response.blob();
        const filename = filenameFromDisposition(response.headers.get("Content-Disposition"), fallbackFilename);
        downloadBlob(blob, filename);
        this.dataManagementStatus = successMessage;
      } catch (error) {
        this.dataManagementError = error?.message || `Could not ${actionLabel.toLowerCase()}.`;
      } finally {
        this.dataManagementAction = "";
      }
    },
    exportDivePdf() {
      return this.exportDownload("/api/exports/dives.pdf", "divevault-dives.pdf", "Exporting PDF", "Dive log PDF downloaded.");
    },
    exportDiveCsv() {
      return this.exportDownload("/api/exports/dives.csv", "divevault-dives.csv", "Exporting CSV", "Dive telemetry CSV downloaded.");
    },
    triggerCsvImport() {
      this.resetDataManagementFeedback();
      this.$refs.csvImportInput?.inputRef?.click();
    },
    triggerSubsurfaceImport() {
      this.resetDataManagementFeedback();
      this.$refs.subsurfaceImportInput?.inputRef?.click();
    },
    async handleCsvImportSelection(event) {
      const file = event?.target?.files?.[0];
      if (event?.target) {
        event.target.value = "";
      }
      if (!file || typeof this.uploadCsvImport !== "function") return;

      this.dataManagementAction = "Previewing CSV";
      this.resetDataManagementFeedback();
      this.pendingImportFile = file;
      this.pendingImportKind = "csv";
      this.importPreview = null;
      try {
        const payload = await this.uploadCsvImport(file, {
          dryRun: true,
          navigateToQueue: false,
          setImportFeedback: false,
          refreshDives: false
        });
        this.importPreview = this.normalizedImportPreview(payload, "csv", file);
        const rows = Number(this.importPreview.rows || 0);
        this.dataManagementStatus = `CSV preview ready: ${rows} row${rows === 1 ? "" : "s"} checked. Review the table before importing.`;
      } catch (error) {
        this.pendingImportFile = null;
        this.pendingImportKind = "";
        this.importPreview = null;
        this.dataManagementError = error?.message || "Could not import the CSV file.";
      } finally {
        this.dataManagementAction = "";
      }
    },
    async handleSubsurfaceImportSelection(event) {
      const file = event?.target?.files?.[0];
      if (event?.target) {
        event.target.value = "";
      }
      if (!file || typeof this.uploadSubsurfaceImport !== "function") return;

      this.dataManagementAction = "Previewing Subsurface";
      this.resetDataManagementFeedback();
      this.pendingImportFile = file;
      this.pendingImportKind = "subsurface";
      this.importPreview = null;
      try {
        const payload = await this.uploadSubsurfaceImport(file, { dryRun: true });
        this.importPreview = this.normalizedImportPreview(payload, "subsurface", file);
        const rows = Number(this.importPreview.rows || 0);
        this.dataManagementStatus = `Subsurface export preview ready: ${rows} dive${rows === 1 ? "" : "s"} checked. Review the table before importing.`;
      } catch (error) {
        this.pendingImportFile = null;
        this.pendingImportKind = "";
        this.importPreview = null;
        this.dataManagementError = error?.message || "Could not preview the Subsurface export.";
      } finally {
        this.dataManagementAction = "";
      }
    },
    async confirmImportPreview() {
      if (!this.pendingImportFile || !this.pendingImportKind || !this.canConfirmImportPreview) return;
      const kind = this.pendingImportKind;
      const file = this.pendingImportFile;
      const label = this.importKindLabel(kind);
      const upload = kind === "subsurface" ? this.uploadSubsurfaceImport : this.uploadCsvImport;
      if (typeof upload !== "function") return;

      this.dataManagementAction = kind === "subsurface" ? "Importing Subsurface" : "Importing CSV";
      this.dataManagementError = "";
      try {
        const payload = await upload(file, {
          dryRun: false,
          navigateToQueue: false,
          setImportFeedback: false,
          refreshDives: false
        });
        this.dataManagementStatus = this.importResultStatus(payload, label);
        this.dataManagementWarning = this.duplicateImportWarning(payload, label);
        this.importReadyForReview = Number(payload?.inserted ?? 0) > 0;
        this.pendingImportFile = null;
        this.pendingImportKind = "";
        this.importPreview = null;
        if (typeof this.refreshDives === "function") {
          await this.refreshDives();
        } else {
          await this.divesStore.fetchDives();
        }
      } catch (error) {
        this.dataManagementError = error?.message || `Could not import the ${label}.`;
      } finally {
        this.dataManagementAction = "";
      }
    },
    cancelImportPreview() {
      this.pendingImportFile = null;
      this.pendingImportKind = "";
      this.importPreview = null;
      this.resetDataManagementFeedback();
    },
    async approveDesktopSync() {
      if (!this.cliAuthCode) return;

      this.desktopSyncApproving = true;
      this.desktopSyncStatus = "";
      this.desktopSyncError = "";

      try {
        const token = await this.authGetToken({ skipCache: true });
        const response = await fetch("/api/cli-auth/approve", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ code: this.cliAuthCode })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || `API returned ${response.status}`);
        }
        this.desktopSyncStatus = payload?.email
          ? `Desktop sync approved for ${payload.email}. Return to the Windows app to continue.`
          : "Desktop sync approved. Return to the Windows app to continue.";
      } catch (error) {
        this.desktopSyncError = error?.message || "Could not approve the desktop sync client.";
      } finally {
        this.desktopSyncApproving = false;
      }
    },
    handleDiveComputerImported() {
      this.dataManagementStatus = "Dive computer import completed. New dives are ready for logbook review.";
      this.importReadyForReview = true;
      if (typeof this.refreshDives === "function") {
        this.refreshDives();
      } else {
        this.divesStore.fetchDives();
      }
    }
  }
};
</script>

<template>
  <div class="settings-panel settings-card">
    <div class="settings-card-header">
      <div>
        <p class="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Data Management</p>
        <h4 class="mt-2 font-headline text-3xl font-bold tracking-tight text-on-surface">Exports And Desktop Sync</h4>
        <p class="mt-3 max-w-3xl text-sm leading-7 text-secondary">
          The actions below are organized as clear task cards instead of one long button list.
        </p>
      </div>
    </div>

    <div v-if="dataManagementStatus" class="settings-feedback border-primary/20 bg-primary/10 text-primary">
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <span>{{ dataManagementStatus }}</span>
        <UButton
          v-if="importReadyForReview"
          type="button"
          @click="reviewImportQueue"
          class="settings-button settings-button-primary shrink-0"
        >
          Review Imported Dives
        </UButton>
      </div>
    </div>
    <div v-if="dataManagementError" class="settings-feedback border-error/20 bg-error-container/20 text-on-error-container">
      {{ dataManagementError }}
    </div>
    <div v-if="dataManagementWarning" class="settings-feedback border-tertiary/30 bg-tertiary/10 text-tertiary">
      <div class="flex items-start gap-3">
        <span class="material-symbols-outlined text-base">warning</span>
        <span>{{ dataManagementWarning }}</span>
      </div>
    </div>

    <div class="settings-action-grid">
      <UButton @click="exportDivePdf" :disabled="isDataManagementBusy || isInteractionLocked" class="settings-action-card">
        <div>
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-primary">picture_as_pdf</span>
            <p class="font-headline text-xl font-bold text-on-surface">
              {{ dataManagementAction === "Exporting PDF" ? "Exporting Dive PDF" : "Export Logs (PDF)" }}
            </p>
          </div>
          <p class="mt-3 text-sm leading-6 text-secondary">
            Generate a printable logbook export for review, sharing, or offline archiving.
          </p>
        </div>
        <span class="material-symbols-outlined text-secondary/60">north_east</span>
      </UButton>

      <UButton @click="exportDiveCsv" :disabled="isDataManagementBusy || isInteractionLocked" class="settings-action-card">
        <div>
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-primary">table_view</span>
            <p class="font-headline text-xl font-bold text-on-surface">
              {{ dataManagementAction === "Exporting CSV" ? "Exporting CSV" : "Export Telemetry (CSV)" }}
            </p>
          </div>
          <p class="mt-3 text-sm leading-6 text-secondary">Download your raw dive records and telemetry samples as a CSV file.</p>
        </div>
        <span class="material-symbols-outlined text-secondary/60">north_east</span>
      </UButton>

      <UButton @click="triggerCsvImport" :disabled="isDataManagementBusy || isInteractionLocked" class="settings-action-card">
        <div>
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-primary">upload_file</span>
            <p class="font-headline text-xl font-bold text-on-surface">
              {{ dataManagementAction === "Previewing CSV" ? "Checking CSV" : "Import Dives (CSV)" }}
            </p>
          </div>
          <p class="mt-3 text-sm leading-6 text-secondary">
            Preview dive logs from a generic CSV spreadsheet before adding them to your imported queue.
          </p>
        </div>
        <span class="material-symbols-outlined text-secondary/60">upload</span>
      </UButton>

      <UButton @click="triggerSubsurfaceImport" :disabled="isDataManagementBusy || isInteractionLocked" class="settings-action-card">
        <div>
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-primary">folder_zip</span>
            <p class="font-headline text-xl font-bold text-on-surface">
              {{ dataManagementAction === "Previewing Subsurface" ? "Checking Subsurface" : "Import Subsurface Export" }}
            </p>
          </div>
          <p class="mt-3 text-sm leading-6 text-secondary">
            Preview exported Subsurface XML logs or dive profiles before adding them to your imported queue.
          </p>
        </div>
        <span class="material-symbols-outlined text-secondary/60">upload</span>
      </UButton>

      <UButton @click="showDiveComputerModal = true" :disabled="isDataManagementBusy || isInteractionLocked" class="settings-action-card">
        <div>
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-primary">cable</span>
            <p class="font-headline text-xl font-bold text-on-surface">Direct Dive Computer Import</p>
          </div>
          <p class="mt-3 text-sm leading-6 text-secondary">
            Connect directly via USB-to-Serial (Aladin Air, Suunto, Mares, Cressi, etc.) using WebSerial.
          </p>
        </div>
        <span class="material-symbols-outlined text-secondary/60">cable</span>
      </UButton>
    </div>

    <div v-if="importPreview" class="settings-import-card mt-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Import Preview</p>
          <h5 class="mt-2 font-headline text-2xl font-bold tracking-tight text-on-surface">
            {{ importPreview.label }} &mdash; {{ importPreview.fileName }}
          </h5>
          <p class="mt-2 text-sm text-secondary">
            {{ importPreview.rows }} row{{ importPreview.rows === 1 ? "" : "s" }} in file &middot; {{ importPreview.valid_rows }} valid
            &middot; {{ importPreview.ready_rows }} ready to import
            <span v-if="importPreview.duplicates > 0">&middot; {{ importPreview.duplicates }} duplicate</span>
            <span v-if="importPreview.invalid_rows > 0">&middot; {{ importPreview.invalid_rows }} invalid</span>
          </p>
        </div>
        <div class="settings-toolbar">
          <UButton @click="cancelImportPreview" :disabled="isDataManagementBusy" class="settings-button settings-button-ghost">
            Cancel
          </UButton>
          <UButton
            @click="confirmImportPreview"
            :disabled="!canConfirmImportPreview || isDataManagementBusy"
            class="settings-button settings-button-primary"
          >
            {{ isDataManagementBusy ? "Importing..." : "Confirm Import" }}
          </UButton>
        </div>
      </div>

      <div v-if="importPreview.dives && importPreview.dives.length > 0" class="mt-6 overflow-x-auto">
        <table class="w-full text-left text-sm text-on-surface">
          <thead class="border-b border-primary/10 text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">
            <tr>
              <th class="pb-3 pr-4">Status</th>
              <th class="pb-3 pr-4">Date</th>
              <th class="pb-3 pr-4">Site</th>
              <th class="pb-3 pr-4">Max Depth</th>
              <th class="pb-3">Duration</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-primary/5">
            <tr v-for="(row, rIndex) in importPreview.dives.slice(0, 10)" :key="'preview-row-' + rIndex">
              <td class="py-3 pr-4">
                <span class="settings-chip text-xs" :class="importPreviewStatusClass(row)">
                  {{ importPreviewStatusLabel(row) }}
                </span>
              </td>
              <td class="py-3 pr-4 font-mono text-xs">{{ displayValue(row.date) }}</td>
              <td class="py-3 pr-4 font-semibold">{{ displayValue(row.site) }}</td>
              <td class="py-3 pr-4">{{ row.max_depth_m ? row.max_depth_m + " m" : "—" }}</td>
              <td class="py-3">{{ row.duration_minutes ? row.duration_minutes + " min" : "—" }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="importPreview.dives.length > 10" class="mt-3 text-xs text-secondary">
          Showing first 10 of {{ importPreview.dives.length }} rows.
        </p>
      </div>
    </div>

    <div v-if="hasCliAuthCode" class="mt-8 rounded-2xl border border-primary/15 bg-surface-container-low p-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Desktop App Sync</p>
          <h4 class="mt-2 font-headline text-2xl font-bold tracking-tight text-on-surface">Approve Dive Computer Sync</h4>
          <p class="mt-2 text-sm text-secondary">
            A desktop helper requested permission to upload dive logs from your dive computer directly to this account.
          </p>
          <div v-if="desktopSyncStatus" class="settings-feedback mt-4 border-primary/20 bg-primary/10 text-primary">
            {{ desktopSyncStatus }}
          </div>
          <div v-if="desktopSyncError" class="settings-feedback mt-4 border-error/20 bg-error-container/20 text-on-error-container">
            {{ desktopSyncError }}
          </div>
        </div>
        <UButton @click="approveDesktopSync" :disabled="desktopSyncApproving" class="settings-button settings-button-primary shrink-0">
          {{ desktopSyncApproving ? "Approving..." : "Approve Sync" }}
        </UButton>
      </div>
    </div>

    <UInput ref="csvImportInput" type="file" accept=".csv,text/csv" class="hidden" @change="handleCsvImportSelection" />
    <UInput
      ref="subsurfaceImportInput"
      type="file"
      accept=".xml,.ssrf,application/xml,text/xml"
      class="hidden"
      @change="handleSubsurfaceImportSelection"
    />

    <DiveComputerImportModal :show="showDiveComputerModal" @close="showDiveComputerModal = false" @imported="handleDiveComputerImported" />
  </div>
</template>
