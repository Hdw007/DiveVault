/**
 * Service orchestrating libdivecomputer WebAssembly and WebSerial transport.
 */

let wasmModulePromise = null;
let supportedModelsCache = null;

export async function loadDiveComputerModule() {
  if (wasmModulePromise) return wasmModulePromise;

  wasmModulePromise = (async () => {
    // Dynamic import of the Emscripten ES6 module from public/wasm
    const wasmScriptUrl = "/wasm/libdivecomputer.js";
    const importedModule = await import(/* @vite-ignore */ wasmScriptUrl);
    const moduleFactory = importedModule.default || importedModule;
    const mod = await moduleFactory({
      locateFile(path) {
        if (path.endsWith(".wasm")) {
          return "/wasm/libdivecomputer.wasm";
        }
        return `/wasm/${path}`;
      }
    });
    return mod;
  })();

  return wasmModulePromise;
}

export async function getSupportedDiveComputers() {
  if (supportedModelsCache) return supportedModelsCache;

  const mod = await loadDiveComputerModule();
  const jsonStr = mod.ccall("dc_bridge_list_models", "string", [], []);
  try {
    const list = JSON.parse(jsonStr || "[]");
    supportedModelsCache = list;
    return list;
  } catch (err) {
    console.error("Failed to parse supported models JSON:", err);
    return [];
  }
}

export async function sha256Hex(bytes) {
  if (!bytes || bytes.length === 0) {
    return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  }
  if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
    try {
      const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      // Fallback below
    }
  }
  let hash = 0;
  for (let i = 0; i < bytes.length; i++) {
    hash = (hash * 31 + bytes[i]) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function bytesToBase64(bytes) {
  if (!bytes || bytes.length === 0) return "";
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function bytesToHex(bytes) {
  if (!bytes) return "";
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function downloadDivesFromDevice({
  vendor,
  product,
  serialDriver,
  fingerprintHex = "",
  onProgress = null,
  onLog = null,
  isCancelled = null
}) {
  const mod = await loadDiveComputerModule();
  const downloadedDives = [];
  const pendingDivePromises = [];
  let latestFingerprint = fingerprintHex;

  // Configure bridge callbacks
  mod.serialBridge = {
    onLog(source, msg) {
      if (typeof onLog === "function") {
        onLog(source, msg);
      }
    },
    async configure(baudRate, dataBits, parity, stopBits, flowControl) {
      return serialDriver.configure(baudRate, dataBits, parity, stopBits, flowControl);
    },
    async setDtr(val) {
      return serialDriver.setDtr(val);
    },
    async setRts(val) {
      return serialDriver.setRts(val);
    },
    async setBreak(val) {
      return serialDriver.setBreak(val);
    },
    async read(destTypedArray, size, timeoutMs) {
      return serialDriver.readBytes(destTypedArray, size, timeoutMs);
    },
    async write(srcTypedArray, size) {
      return serialDriver.writeBytes(srcTypedArray, size);
    },
    async sleep(ms) {
      return serialDriver.sleep(ms);
    },
    async close() {
      return serialDriver.close();
    },
    isCancelled() {
      return Boolean(isCancelled && isCancelled());
    },
    onProgress(progress) {
      if (typeof onProgress === "function") {
        onProgress(progress);
      }
    },
    onDive(metaJson, rawBytesOrPtr, fpBytesOrPtr, rawSize, fpSize) {
      try {
        const meta = JSON.parse(metaJson);
        let rawBytes;
        if (rawBytesOrPtr instanceof Uint8Array) {
          rawBytes = rawBytesOrPtr;
        } else if (typeof rawBytesOrPtr === "number" && mod.HEAPU8 && rawSize) {
          rawBytes = mod.HEAPU8.slice(rawBytesOrPtr, rawBytesOrPtr + rawSize);
        } else {
          rawBytes = new Uint8Array(0);
        }

        let fpBytes;
        if (fpBytesOrPtr instanceof Uint8Array) {
          fpBytes = fpBytesOrPtr;
        } else if (typeof fpBytesOrPtr === "number" && mod.HEAPU8 && fpSize) {
          fpBytes = mod.HEAPU8.slice(fpBytesOrPtr, fpBytesOrPtr + fpSize);
        } else {
          fpBytes = null;
        }

        const diveIndex = downloadedDives.length + 1;
        if (typeof onLog === "function") {
          onLog(
            "service",
            `Captured dive #${diveIndex}: ${meta.started_at || "unknown"}, ${meta.duration_seconds || 0}s, ${meta.max_depth_m || 0}m (${rawBytes.length} raw bytes)`
          );
        }

        const p = (async () => {
          try {
            const rawSha256 = await sha256Hex(rawBytes);
            const rawB64 = bytesToBase64(rawBytes);
            const fpHex = fpBytes ? bytesToHex(fpBytes) : null;
            const startedAt = meta.started_at && meta.started_at.length >= 10 ? meta.started_at : new Date().toISOString();
            const dateSlug = startedAt.replace(/[:.]/g, "-");
            const uid = fpHex
              ? `${vendor}:${product}:${dateSlug}:${fpHex}`
              : `${vendor}:${product}:${dateSlug}:${rawSha256.substring(0, 16)}`;

            const diveRecord = {
              vendor,
              product,
              dive_uid: uid,
              fingerprint_hex: fpHex,
              started_at: startedAt,
              duration_seconds: meta.duration_seconds || 0,
              max_depth_m: meta.max_depth_m || 0,
              avg_depth_m: meta.avg_depth_m || 0,
              fields: meta.fields || {},
              raw_sha256: rawSha256,
              raw_data_b64: rawB64,
              samples: meta.samples || []
            };

            downloadedDives.push(diveRecord);
          } catch (err) {
            if (typeof onLog === "function") {
              onLog("service", `Error formatting dive record #${diveIndex}: ${err?.message || err}`);
            }
            console.error("Error processing parsed dive:", err);
          }
        })();

        pendingDivePromises.push(p);
      } catch (err) {
        if (typeof onLog === "function") {
          onLog("service", `Fatal error in onDive callback: ${err?.message || err}`);
        }
        console.error("Error synchronously capturing dive data in onDive:", err);
      }
    },
    onComplete(fpHex, _count) {
      if (fpHex) latestFingerprint = fpHex;
    }
  };

  try {
    const rc = await mod.ccall("dc_bridge_download", "number", ["string", "string", "string"], [vendor, product, fingerprintHex || ""], {
      async: true
    });

    // Wait for all async dive record formatting/hashing tasks to settle
    await Promise.all(pendingDivePromises);

    if (typeof onLog === "function") {
      onLog("service", `Processing complete: ${downloadedDives.length} dives ready for review.`);
    }

    return {
      status: rc,
      dives: downloadedDives,
      latestFingerprint
    };
  } finally {
    mod.serialBridge = null;
  }
}
