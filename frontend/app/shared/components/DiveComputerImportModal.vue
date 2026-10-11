<script>
import { createApiClient } from "~/shared/api/client.js";
import { useAuth } from "~/shared/composables/auth.js";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useDiveComputerSerial } from "~/shared/composables/use-dive-computer-serial.js";
import { getSupportedDiveComputers, downloadDivesFromDevice } from "~/shared/services/dive-computer-service.js";
import { createDive, fetchDeviceState, saveDeviceState } from "~/shared/api/dives.js";
import { formatDepthNumber, durationShort, formatDate, formatTime } from "~/shared/utils/core.js";

const STORAGE_KEY_VENDOR = "divevault_dc_vendor";
const STORAGE_KEY_PRODUCT = "divevault_dc_product";

export default {
  name: "DiveComputerImportModal",
  props: {
    show: {
      type: Boolean,
      default: false
    }
  },
  emits: ["close", "imported"],
  setup() {
    const divesStore = useDivesStore();
    const { getToken } = useAuth();
    const apiClient = createApiClient({ getToken: () => getToken({ skipCache: true }) });
    const serial = useDiveComputerSerial();

    return {
      divesStore,
      apiClient,
      serial
    };
  },
  data() {
    return {
      step: "select", // "select" | "connecting" | "transferring" | "preview" | "completed"
      supportedModels: [],
      selectedVendor: "Uwatec",
      selectedProduct: "Aladin Air",
      searchQuery: "",
      progressStage: "",
      progressCurrent: 0,
      progressTotal: 100,
      progressMessage: "",
      errorMessage: "",
      discoveredDives: [],
      latestFingerprint: "",
      importingDives: false,
      importedCount: 0,
      skippedCount: 0,
      isCancelled: false,
      debugLogs: [],
      showDebugLogs: false,
      copiedLogs: false,
      selectedDiveUids: []
    };
  },
  computed: {
    isSerialSupported() {
      return this.serial.isSupported.value;
    },
    uniqueVendors() {
      const set = new Set(this.supportedModels.map((m) => m.vendor));
      return Array.from(set).sort();
    },
    productsForSelectedVendor() {
      return this.supportedModels
        .filter((m) => m.vendor === this.selectedVendor)
        .map((m) => m.product)
        .sort();
    },
    filteredProducts() {
      if (!this.searchQuery) return this.productsForSelectedVendor;
      const q = this.searchQuery.toLowerCase();
      return this.productsForSelectedVendor.filter((p) => p.toLowerCase().includes(q));
    },
    progressPercent() {
      if (this.progressTotal <= 0) return 0;
      return Math.min(100, Math.round((this.progressCurrent / this.progressTotal) * 100));
    },
    isAllSelected() {
      return this.discoveredDives.length > 0 && this.selectedDiveUids.length === this.discoveredDives.length;
    },
    isSomeSelected() {
      return this.selectedDiveUids.length > 0 && this.selectedDiveUids.length < this.discoveredDives.length;
    },
    selectedDivesCount() {
      return this.selectedDiveUids.length;
    },
    divesToImport() {
      const selectedSet = new Set(this.selectedDiveUids);
      return this.discoveredDives.filter((d) => selectedSet.has(d.dive_uid));
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.initModal();
      } else {
        this.resetState();
      }
    },
    selectedVendor(newVal) {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY_VENDOR, newVal);
      }
      const products = this.productsForSelectedVendor;
      if (products.length > 0 && !products.includes(this.selectedProduct)) {
        this.selectedProduct = products[0];
      }
    },
    selectedProduct(newVal) {
      if (typeof window !== "undefined" && newVal) {
        window.localStorage.setItem(STORAGE_KEY_PRODUCT, newVal);
      }
    }
  },
  mounted() {
    if (this.show) {
      this.initModal();
    }
  },
  methods: {
    formatDepthNumber,
    durationShort,
    formatDate,
    formatTime,
    async initModal() {
      this.errorMessage = "";
      this.step = "select";

      // Load saved preferences
      if (typeof window !== "undefined") {
        const savedVendor = window.localStorage.getItem(STORAGE_KEY_VENDOR);
        const savedProduct = window.localStorage.getItem(STORAGE_KEY_PRODUCT);
        if (savedVendor) this.selectedVendor = savedVendor;
        if (savedProduct) {
          this.selectedProduct = savedProduct === "Aladin Air Twin" ? "Aladin Air" : savedProduct;
        }
      }

      // Load models from Wasm
      try {
        const models = await getSupportedDiveComputers();
        this.supportedModels = models;

        // If Uwatec has Aladin Air variants and no exact match, pick first Aladin
        if (this.selectedVendor === "Uwatec" && !this.productsForSelectedVendor.includes(this.selectedProduct)) {
          const aladin = this.productsForSelectedVendor.find((p) => p.includes("Aladin"));
          if (aladin) this.selectedProduct = aladin;
        }
      } catch (err) {
        this.errorMessage = "Failed to load dive computer driver database: " + (err?.message || err);
      }
    },
    resetState() {
      this.step = "select";
      this.errorMessage = "";
      this.progressStage = "";
      this.progressCurrent = 0;
      this.progressTotal = 100;
      this.progressMessage = "";
      this.discoveredDives = [];
      this.selectedDiveUids = [];
      this.latestFingerprint = "";
      this.importingDives = false;
      this.importedCount = 0;
      this.skippedCount = 0;
      this.isCancelled = false;
      this.serial.close();
    },
    closeModal() {
      this.isCancelled = true;
      this.serial.close();
      this.$emit("close");
    },
    async handleConnectAndDownload() {
      this.errorMessage = "";
      this.isCancelled = false;
      this.discoveredDives = [];
      this.debugLogs = [];
      this.showDebugLogs = true;

      if (typeof this.serial.setLogCallback === "function") {
        this.serial.setLogCallback((source, msg) => this.addDebugLog(source, msg));
      }

      try {
        // Step 1: Request serial port via user gesture
        this.step = "connecting";
        this.progressMessage = "Selecting serial port...";
        await this.serial.requestPort();

        // Step 2: Open serial port (Aladin Air uses 19200 baud)
        this.progressMessage = `Opening port for ${this.selectedVendor} ${this.selectedProduct}...`;
        await this.serial.open({ baudRate: 19200 });

        // Step 3: Fetch last device state fingerprint
        this.progressMessage = "Checking previous sync state...";
        let prevFingerprint = "";
        try {
          const stateRes = await fetchDeviceState(this.apiClient, this.selectedVendor, this.selectedProduct);
          if (stateRes.ok) {
            const stateData = await stateRes.json();
            prevFingerprint = stateData.fingerprint_hex || "";
            if (prevFingerprint) {
              this.addDebugLog("service", `Previous sync fingerprint: ${prevFingerprint}`);
            }
          }
        } catch {
          // If state doesn't exist yet, start clean
        }

        // Step 4: Start download via libdivecomputer Wasm
        this.step = "transferring";
        this.progressStage = "connecting";
        this.progressMessage = "Synchronizing with dive computer (checking contacts)...";
        this.progressCurrent = 0;
        this.progressTotal = 100;

        const downloadFn =
          typeof window !== "undefined" && window.__testMockDownloadDives ? window.__testMockDownloadDives : downloadDivesFromDevice;

        const result = await downloadFn({
          vendor: this.selectedVendor,
          product: this.selectedProduct,
          serialDriver: this.serial,
          fingerprintHex: prevFingerprint,
          onLog: (source, msg) => this.addDebugLog(source, msg),
          onProgress: (p) => {
            this.progressStage = p.stage;
            this.progressCurrent = p.current;
            this.progressTotal = p.total || 100;
            if (p.stage === "reading") {
              this.progressMessage = `Reading memory dump (${p.current} / ${p.total} bytes)...`;
            } else if (p.stage === "waiting") {
              this.progressMessage =
                "Waiting for dive computer transmission... (Bridge / wet the contacts on your Aladin to start transfer)";
            } else {
              this.progressMessage = `Status: ${p.stage}...`;
            }
          },
          isCancelled: () => this.isCancelled
        });

        await this.serial.close();

        if (this.isCancelled) {
          this.step = "select";
          return;
        }

        if (result.status !== 0 && result.status !== 1) {
          const statusMessages = {
            "-1": "Device or operation unsupported by driver",
            "-2": "Invalid arguments supplied to driver",
            "-3": "Out of memory in driver",
            "-4": `Device model "${this.selectedVendor} ${this.selectedProduct}" not found in libdivecomputer descriptor list`,
            "-5": "Serial port access denied",
            "-6": "Communication I/O error on serial port",
            "-7": "Communication timed out waiting for dive computer",
            "-8": "Protocol error during dive computer transmission",
            "-9": "Unexpected data format received from dive computer",
            "-10": "Transfer was cancelled"
          };
          const errDetail = statusMessages[String(result.status)] || `Transfer failed with status code ${result.status}`;
          this.errorMessage = errDetail;
          this.step = "select";
          return;
        }

        this.latestFingerprint = result.latestFingerprint || "";
        this.discoveredDives = result.dives || [];
        this.selectedDiveUids = this.discoveredDives.map((d) => d.dive_uid);

        if (this.discoveredDives.length === 0) {
          this.progressMessage = "No new dive records found on the device.";
          this.step = "completed";
          return;
        }

        this.step = "preview";
      } catch (err) {
        await this.serial.close();
        this.step = "select";
        this.errorMessage = err?.message || "Failed to download from dive computer.";
      }
    },
    toggleSelectAll() {
      if (this.isAllSelected) {
        this.selectedDiveUids = [];
      } else {
        this.selectedDiveUids = this.discoveredDives.map((d) => d.dive_uid);
      }
    },
    toggleDiveSelection(diveUid) {
      const idx = this.selectedDiveUids.indexOf(diveUid);
      if (idx > -1) {
        this.selectedDiveUids.splice(idx, 1);
      } else {
        this.selectedDiveUids.push(diveUid);
      }
    },
    async handleConfirmImport() {
      const targetDives = this.divesToImport;
      if (targetDives.length === 0) return;

      this.importingDives = true;
      this.errorMessage = "";
      this.importedCount = 0;
      this.skippedCount = 0;

      try {
        for (const dive of targetDives) {
          const res = await createDive(this.apiClient, dive);
          if (res.ok) {
            const data = await res.json();
            if (data.inserted) {
              this.importedCount++;
            } else {
              this.skippedCount++;
            }
          }
        }

        // Update device sync state
        if (this.latestFingerprint) {
          try {
            await saveDeviceState(this.apiClient, this.selectedVendor, this.selectedProduct, this.latestFingerprint);
          } catch {
            // Ignore device state save error
          }
        }

        // Refresh dive store in background without unmounting layout
        await this.divesStore.fetchDives(null, { silent: true });

        this.step = "completed";
      } catch (err) {
        this.errorMessage = "Error during import upload: " + (err?.message || err);
      } finally {
        this.importingDives = false;
      }
    },
    handleDone() {
      this.$emit("imported", {
        importedCount: this.importedCount,
        skippedCount: this.skippedCount,
        dives: this.divesToImport
      });
      this.closeModal();
    },
    addDebugLog(source, message) {
      const now = new Date();
      const timeStr = now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
      this.debugLogs.push({
        id: Date.now() + Math.random(),
        time: timeStr,
        source: String(source).toLowerCase(),
        message: String(message)
      });
      if (this.debugLogs.length > 600) {
        this.debugLogs.shift();
      }
      this.$nextTick(() => {
        const el = this.$refs.debugLogContainer;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    },
    async copyDebugLogs() {
      const text = this.debugLogs.map((l) => `[${l.time}] [${l.source.toUpperCase()}] ${l.message}`).join("\n");
      try {
        await navigator.clipboard.writeText(text);
        this.copiedLogs = true;
        setTimeout(() => {
          this.copiedLogs = false;
        }, 2000);
      } catch (err) {
        console.error("Clipboard copy failed:", err);
      }
    },
    clearDebugLogs() {
      this.debugLogs = [];
    },
    toggleDebugLogs() {
      this.showDebugLogs = !this.showDebugLogs;
    }
  }
};
</script>

<template>
  <div
    v-if="show"
    @click.self="closeModal"
    class="fixed inset-0 z-[55] flex items-center justify-center bg-background/88 px-6 py-8 backdrop-blur-sm"
  >
    <div class="settings-modal-card max-w-2xl">
      <!-- Modal Header -->
      <div class="flex items-start justify-between gap-4 border-b border-primary/10 pb-5">
        <div>
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-primary">WebSerial Direct Import</p>
          <h3 class="mt-2 font-headline text-2xl font-bold tracking-tight text-on-surface">Connect Dive Computer</h3>
          <p class="mt-1 text-xs text-secondary">Download telemetry directly via USB-to-Serial using libdivecomputer</p>
        </div>
        <UButton
          type="button"
          @click="closeModal"
          :disabled="step === 'transferring' || importingDives"
          class="settings-button settings-button-ghost"
        >
          Close
        </UButton>
      </div>

      <!-- Feedback / Errors -->
      <div v-if="errorMessage" class="settings-feedback mt-5 border-error/20 bg-error-container/20 text-on-error-container">
        {{ errorMessage }}
      </div>

      <!-- Step 1: Device Selection & Browser Check -->
      <div v-if="step === 'select'" class="mt-6 space-y-6">
        <!-- Browser Support Banner -->
        <div
          v-if="!isSerialSupported"
          class="rounded-xl border border-warning/20 bg-warning-container/20 p-4 text-xs text-on-warning-container"
        >
          <p class="font-bold">Web Serial API is not supported in this browser environment.</p>
          <p class="mt-1">
            Please use <strong>Firefox 151+</strong> or a <strong>Chromium-based browser</strong> (Chrome, Edge, Brave). If on Firefox,
            verify <code>dom.webserial.enabled</code> is set in <code>about:config</code>.
          </p>
        </div>

        <div v-else class="rounded-xl border border-primary/15 bg-primary/5 p-4 text-xs text-on-surface-variant">
          <p class="font-semibold text-primary">Ready to Connect</p>
          <p class="mt-1">
            Ensure your <strong>Aladin Air</strong> interface cable is connected to a USB port. On Linux, ensure your user account has
            access to the <code>dialout</code> group (e.g. <code>sudo usermod -aG dialout $USER</code>).
          </p>
        </div>

        <!-- Vendor & Product Selectors -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Manufacturer</span>
            <select
              v-model="selectedVendor"
              class="w-full rounded-lg border border-primary/20 bg-surface-container-high px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            >
              <option v-for="vendor in uniqueVendors" :key="vendor" :value="vendor">{{ vendor }}</option>
            </select>
          </label>

          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Model</span>
            <select
              v-model="selectedProduct"
              class="w-full rounded-lg border border-primary/20 bg-surface-container-high px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            >
              <option v-for="product in filteredProducts" :key="product" :value="product">{{ product }}</option>
            </select>
          </label>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-3 pt-4 border-t border-primary/10">
          <UButton type="button" @click="closeModal" class="settings-button settings-button-ghost"> Cancel </UButton>
          <UButton
            type="button"
            :disabled="!isSerialSupported || !selectedProduct"
            @click="handleConnectAndDownload"
            class="settings-button settings-button-primary"
          >
            Connect &amp; Download Dives
          </UButton>
        </div>
      </div>

      <!-- Step 2 & 3: Connecting / Transferring -->
      <div v-else-if="step === 'connecting' || step === 'transferring'" class="mt-8 space-y-6 text-center">
        <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <span class="material-symbols-outlined animate-spin text-3xl">sync</span>
        </div>

        <div>
          <h4 class="font-headline text-lg font-bold text-on-surface">
            {{ step === "connecting" ? "Establishing Connection..." : "Downloading Dive Telemetry..." }}
          </h4>
          <p class="mt-1 text-sm text-secondary">{{ progressMessage }}</p>
        </div>

        <!-- Progress Bar -->
        <div v-if="step === 'transferring'" class="space-y-2">
          <div class="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
            <div class="h-full bg-primary transition-all duration-300" :style="{ width: progressPercent + '%' }"></div>
          </div>
          <p class="text-xs text-secondary font-mono">{{ progressPercent }}%</p>
        </div>

        <div class="pt-4">
          <UButton type="button" @click="closeModal" class="settings-button settings-button-ghost"> Cancel </UButton>
        </div>
      </div>

      <!-- Step 4: Preview Discovered Dives -->
      <div v-else-if="step === 'preview'" class="mt-6 space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h4 class="font-headline text-lg font-bold text-on-surface">Discovered Dives</h4>
            <p class="text-xs text-secondary">
              Found {{ discoveredDives.length }} dive{{ discoveredDives.length === 1 ? "" : "s" }} ready to import into your logbook.
            </p>
          </div>
          <span class="rounded bg-primary/15 px-3 py-1 font-mono text-xs font-bold text-primary">
            {{ selectedDivesCount }} of {{ discoveredDives.length }} Selected
          </span>
        </div>

        <!-- Dives Summary Table -->
        <div class="max-h-64 overflow-y-auto rounded-xl border border-primary/10">
          <table class="w-full text-left text-sm text-on-surface">
            <thead
              class="sticky top-0 z-10 bg-surface-container-high border-b border-primary/10 text-[10px] font-bold uppercase tracking-wider text-secondary"
            >
              <tr>
                <th class="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    :checked="isAllSelected"
                    @change="toggleSelectAll"
                    class="h-4 w-4 rounded border-primary/30 bg-surface-container text-primary focus:ring-primary cursor-pointer accent-primary"
                    title="Select / Deselect All"
                  />
                </th>
                <th class="p-3">#</th>
                <th class="p-3">Date / Time</th>
                <th class="p-3">Max Depth</th>
                <th class="p-3">Duration</th>
                <th class="p-3">Samples</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-primary/5">
              <tr
                v-for="(dive, idx) in discoveredDives"
                :key="dive.dive_uid || idx"
                @click="toggleDiveSelection(dive.dive_uid)"
                class="cursor-pointer transition-colors hover:bg-primary/5 select-none"
                :class="{ 'bg-primary/[0.04]': selectedDiveUids.includes(dive.dive_uid) }"
              >
                <td class="p-3 w-10 text-center" @click.stop>
                  <input
                    type="checkbox"
                    :value="dive.dive_uid"
                    v-model="selectedDiveUids"
                    class="h-4 w-4 rounded border-primary/30 bg-surface-container text-primary focus:ring-primary cursor-pointer accent-primary"
                  />
                </td>
                <td class="p-3 font-mono text-xs text-secondary">{{ idx + 1 }}</td>
                <td class="p-3 font-medium">{{ formatDate(dive.started_at) }} {{ formatTime(dive.started_at) }}</td>
                <td class="p-3 font-mono text-primary">{{ formatDepthNumber(dive.max_depth_m) }} m</td>
                <td class="p-3">{{ durationShort(dive.duration_seconds) }}</td>
                <td class="p-3 text-secondary text-xs">{{ dive.samples?.length || 0 }} pts</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-3 pt-4 border-t border-primary/10">
          <UButton type="button" @click="closeModal" :disabled="importingDives" class="settings-button settings-button-ghost">
            Cancel
          </UButton>
          <button
            type="button"
            :disabled="importingDives || selectedDivesCount === 0"
            @click="handleConfirmImport"
            class="settings-button settings-button-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ importingDives ? "Importing Dives..." : `Import ${selectedDivesCount} Dives` }}
          </button>
        </div>
      </div>

      <!-- Step 5: Completed -->
      <div v-else-if="step === 'completed'" class="mt-8 space-y-6 text-center">
        <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
          <span class="material-symbols-outlined text-3xl">check_circle</span>
        </div>

        <div>
          <h4 class="font-headline text-xl font-bold text-on-surface">Import Complete!</h4>
          <p class="mt-2 text-sm text-secondary">
            <span v-if="importedCount > 0"
              >{{ importedCount }} new dive{{ importedCount === 1 ? "" : "s" }} imported into the review queue.</span
            >
            <span v-if="skippedCount > 0" class="ml-1">({{ skippedCount }} duplicate{{ skippedCount === 1 ? "" : "s" }} skipped).</span>
            <span v-if="importedCount === 0 && skippedCount === 0">No new dives to import.</span>
          </p>
        </div>

        <div class="pt-4 flex justify-center gap-3">
          <UButton type="button" @click="handleDone" class="settings-button settings-button-primary"> Done </UButton>
        </div>
      </div>

      <!-- Live Debug Console -->
      <div class="mt-6 border-t border-primary/10 pt-4">
        <div class="flex items-center justify-between text-xs">
          <button
            type="button"
            @click="toggleDebugLogs"
            class="flex items-center gap-1.5 font-mono font-medium text-secondary hover:text-on-surface transition-colors"
          >
            <span class="material-symbols-outlined text-base transition-transform duration-200" :class="{ 'rotate-90': showDebugLogs }">
              chevron_right
            </span>
            <span>Debug Log ({{ debugLogs.length }} lines)</span>
          </button>

          <div v-if="debugLogs.length > 0" class="flex items-center gap-2">
            <button
              type="button"
              @click="copyDebugLogs"
              class="flex items-center gap-1 rounded bg-surface-container-high px-2 py-1 text-[11px] font-medium text-on-surface hover:bg-surface-container-highest transition-colors"
            >
              <span class="material-symbols-outlined text-xs">{{ copiedLogs ? "check" : "content_copy" }}</span>
              <span>{{ copiedLogs ? "Copied!" : "Copy Logs" }}</span>
            </button>
            <button
              type="button"
              @click="clearDebugLogs"
              class="rounded bg-surface-container-high px-2 py-1 text-[11px] font-medium text-secondary hover:text-on-surface hover:bg-surface-container-highest transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        <div
          v-if="showDebugLogs"
          ref="debugLogContainer"
          class="mt-3 max-h-48 overflow-y-auto rounded-lg border border-primary/20 bg-black/85 p-3 font-mono text-[11px] leading-relaxed text-slate-300 select-text"
        >
          <div v-if="debugLogs.length === 0" class="text-slate-500 italic">
            No log entries yet. Connect a dive computer to inspect raw transfer logs.
          </div>
          <div v-for="log in debugLogs" :key="log.id" class="flex items-start gap-2 py-0.5 hover:bg-white/5">
            <span class="text-slate-500 shrink-0 select-none">{{ log.time }}</span>
            <span
              class="rounded px-1 text-[10px] uppercase font-bold shrink-0"
              :class="{
                'bg-cyan-950 text-cyan-400 border border-cyan-800/50': log.source === 'serial',
                'bg-purple-950 text-purple-400 border border-purple-800/50': log.source === 'wasm' || log.source === 'bridge',
                'bg-amber-950 text-amber-400 border border-amber-800/50': log.source === 'libdc',
                'bg-emerald-950 text-emerald-400 border border-emerald-800/50': log.source === 'service'
              }"
            >
              {{ log.source }}
            </span>
            <span class="break-all whitespace-pre-wrap">{{ log.message }}</span>
          </div>
        </div>

        <!-- Driver Attribution -->
        <p class="mt-4 text-center text-[11px] text-secondary/60">
          Hardware drivers powered by
          <a href="https://libdivecomputer.org/" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline font-medium">
            libdivecomputer
          </a>
          (LGPL-2.1)
        </p>
      </div>
    </div>
  </div>
</template>
