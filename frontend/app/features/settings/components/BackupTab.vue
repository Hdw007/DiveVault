<script>
import { createApiClient } from "~/shared/api/client.js";
import { useAuth } from "~/shared/composables/auth.js";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useProfileStore } from "~/shared/composables/use-profile-store.js";

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
  name: "BackupTab",
  setup() {
    const profileStore = useProfileStore();
    const divesStore = useDivesStore();
    const { getToken } = useAuth();
    const apiClient = createApiClient({ getToken: () => getToken({ skipCache: true }) });
    const authenticatedFetch = (res, opts) => apiClient.request(res, opts);

    return {
      profileStore,
      divesStore,
      authenticatedFetch
    };
  },
  data() {
    return {
      dataManagementAction: "",
      dataManagementStatus: "",
      dataManagementError: ""
    };
  },
  computed: {
    isDataManagementBusy() {
      return Boolean(this.dataManagementAction);
    },
    isInteractionLocked() {
      return this.profileStore.isLoading || this.profileStore.isSaving || this.isDataManagementBusy;
    }
  },
  methods: {
    resetDataManagementFeedback() {
      this.dataManagementStatus = "";
      this.dataManagementError = "";
    },
    triggerBackupImport() {
      this.resetDataManagementFeedback();
      this.$refs.backupImportInput?.inputRef?.click();
    },
    async exportBackup() {
      this.dataManagementAction = "Exporting Backup";
      this.resetDataManagementFeedback();
      try {
        const response = await this.authenticatedFetch("/api/backup/export");
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }
        const blob = await response.blob();
        const filename = filenameFromDisposition(response.headers.get("Content-Disposition"), "divevault-backup.zip");
        downloadBlob(blob, filename);
        this.dataManagementStatus = "Full backup downloaded.";
      } catch (error) {
        this.dataManagementError = error?.message || "Could not download backup.";
      } finally {
        this.dataManagementAction = "";
      }
    },
    async handleBackupImportSelection(event) {
      const file = event?.target?.files?.[0];
      if (event?.target) {
        event.target.value = "";
      }
      if (!file) return;

      this.dataManagementAction = "Importing Backup";
      this.resetDataManagementFeedback();
      try {
        const response = await this.authenticatedFetch("/api/backup/import", {
          method: "POST",
          headers: {
            "Content-Type": file.type || (file.name.toLowerCase().endsWith(".zip") ? "application/zip" : "application/json")
          },
          body: file
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || `API returned ${response.status}`);
        }

        if (payload?.profile) {
          this.profileStore.hydrateProfileState(payload.profile);
        } else {
          await this.profileStore.fetchProfile();
        }

        await this.divesStore.fetchDives();

        const summary = payload?.summary || {};
        this.dataManagementStatus = `Backup imported. ${summary.dives_inserted ?? 0} new dives added from ${summary.dives_in_backup ?? 0} backup dives.`;
      } catch (error) {
        this.dataManagementError = error?.message || "Could not import the backup file.";
      } finally {
        this.dataManagementAction = "";
      }
    }
  }
};
</script>

<template>
  <div class="settings-panel settings-card">
    <div class="settings-card-header">
      <div>
        <p class="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Backup</p>
        <h4 class="mt-2 font-headline text-3xl font-bold tracking-tight text-on-surface">Backup And Restore</h4>
        <p class="mt-3 max-w-3xl text-sm leading-7 text-secondary">
          Backup tasks are separated from everyday exports so destructive restore actions feel more deliberate and easier to understand.
        </p>
      </div>
    </div>

    <div v-if="dataManagementStatus" class="settings-feedback border-primary/20 bg-primary/10 text-primary">{{ dataManagementStatus }}</div>
    <div v-if="dataManagementError" class="settings-feedback border-error/20 bg-error-container/20 text-on-error-container">
      {{ dataManagementError }}
    </div>

    <div class="settings-action-grid">
      <UButton @click="exportBackup" :disabled="isDataManagementBusy || isInteractionLocked" class="settings-action-card">
        <div>
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-primary">archive</span>
            <p class="font-headline text-xl font-bold text-on-surface">
              {{ dataManagementAction === "Exporting Backup" ? "Building Full Backup" : "Download Full Backup" }}
            </p>
          </div>
          <p class="mt-3 text-sm leading-6 text-secondary">
            Save your account data, saved lists, PDFs, and imported dive state into one ZIP archive.
          </p>
        </div>
        <span class="material-symbols-outlined text-secondary/60">download</span>
      </UButton>

      <UButton @click="triggerBackupImport" :disabled="isDataManagementBusy || isInteractionLocked" class="settings-action-card">
        <div>
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-primary">upload_file</span>
            <p class="font-headline text-xl font-bold text-on-surface">
              {{ dataManagementAction === "Importing Backup" ? "Importing Backup" : "Import From Backup" }}
            </p>
          </div>
          <p class="mt-3 text-sm leading-6 text-secondary">
            Restore from a previously exported ZIP backup when moving systems or recovering state.
          </p>
        </div>
        <span class="material-symbols-outlined text-secondary/60">upload</span>
      </UButton>
    </div>
    <UInput
      ref="backupImportInput"
      type="file"
      accept=".zip,application/zip,application/x-zip-compressed,.json,application/json"
      class="hidden"
      @change="handleBackupImportSelection"
    />
  </div>
</template>
