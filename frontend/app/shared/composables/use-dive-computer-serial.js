import { ref, computed } from "vue";

/**
 * Composable for managing Web Serial API connections for dive computers.
 */
export function useDiveComputerSerial() {
  const isSupported = computed(() => {
    return typeof navigator !== "undefined" && "serial" in navigator && Boolean(navigator.serial);
  });

  const activePort = ref(null);
  const isConnected = ref(false);
  const isReading = ref(false);
  const lastError = ref(null);

  let streamReader = null;
  let streamWriter = null;
  let readChunks = [];
  let readWaiters = [];
  let isStreamOpen = false;
  let currentConfig = null;

  function resetBuffers() {
    readChunks = [];
    for (const waiter of readWaiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve({ status: -10, bytesRead: 0 }); // -10 = DC_STATUS_CANCELLED
    }
    readWaiters = [];
  }

  function totalBufferedBytes() {
    return readChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  }

  function pumpIncomingData() {
    if (!activePort.value || !activePort.value.readable || streamReader) return;

    try {
      streamReader = activePort.value.readable.getReader();
      isStreamOpen = true;
    } catch (err) {
      lastError.value = err?.message || "Failed to acquire serial stream reader";
      return;
    }

    (async () => {
      try {
        while (isStreamOpen && activePort.value) {
          const { value, done } = await streamReader.read();
          if (done) break;
          if (value && value.length > 0) {
            readChunks.push(value);
            checkWaiters();
          }
        }
      } catch {
        // Stream reading terminated or cancelled
      } finally {
        if (streamReader) {
          try {
            streamReader.releaseLock();
          } catch {
            // Reader already released
          }
          streamReader = null;
        }
      }
    })();
  }

  function checkWaiters() {
    while (readWaiters.length > 0) {
      const waiter = readWaiters[0];
      const available = totalBufferedBytes();
      if (available >= waiter.size) {
        readWaiters.shift();
        if (waiter.timer) clearTimeout(waiter.timer);

        // Copy bytes to target subarray
        let copied = 0;
        while (copied < waiter.size && readChunks.length > 0) {
          const chunk = readChunks[0];
          const needed = waiter.size - copied;
          if (chunk.length <= needed) {
            waiter.dest.set(chunk, copied);
            copied += chunk.length;
            readChunks.shift();
          } else {
            waiter.dest.set(chunk.subarray(0, needed), copied);
            readChunks[0] = chunk.subarray(needed);
            copied += needed;
          }
        }
        waiter.resolve({ status: 0, bytesRead: waiter.size });
      } else {
        break;
      }
    }
  }

  async function requestPort(filters = []) {
    lastError.value = null;
    if (!isSupported.value) {
      throw new Error("Web Serial API is not supported in this browser. Please use Chrome/Edge or Firefox 151+.");
    }
    try {
      const port = await navigator.serial.requestPort(filters.length ? { filters } : {});
      activePort.value = port;
      return port;
    } catch (err) {
      if (err.name === "NotFoundError") {
        throw new Error("No serial port selected", { cause: err });
      }
      throw err;
    }
  }

  async function open(options = {}) {
    if (!activePort.value) {
      throw new Error("No serial port selected. Call requestPort() first.");
    }

    const serialOptions = {
      baudRate: options.baudRate || 19200,
      dataBits: options.dataBits || 8,
      stopBits: options.stopBits || 1,
      parity: options.parity || "none",
      bufferSize: options.bufferSize || 4096,
      flowControl: options.flowControl || "none"
    };

    resetBuffers();

    try {
      await activePort.value.open(serialOptions);
      currentConfig = { ...serialOptions };
      isConnected.value = true;
      pumpIncomingData();
    } catch (err) {
      lastError.value = err?.message || "Failed to open serial port";
      throw err;
    }
  }

  async function configure(baudRate, dataBits, parityEnum, stopBitsEnum, flowControlEnum) {
    const parityMap = { 0: "none", 1: "odd", 2: "even" };
    const stopBitsMap = { 0: 1, 1: 1.5, 2: 2 };
    const flowControlMap = { 0: "none", 1: "hardware", 2: "software" };

    const opts = {
      baudRate: baudRate || 19200,
      dataBits: dataBits || 8,
      parity: parityMap[parityEnum] || "none",
      stopBits: stopBitsMap[stopBitsEnum] || 1,
      flowControl: flowControlMap[flowControlEnum] || "none"
    };

    if (!activePort.value) return -6; // DC_STATUS_IO

    // Skip redundant reconnection if already configured with matching parameters
    const isSameConfig =
      currentConfig &&
      currentConfig.baudRate === opts.baudRate &&
      currentConfig.dataBits === opts.dataBits &&
      currentConfig.parity === opts.parity &&
      currentConfig.stopBits === opts.stopBits &&
      currentConfig.flowControl === opts.flowControl;

    if (isSameConfig && isConnected.value && isStreamOpen) {
      return 0; // DC_STATUS_SUCCESS
    }

    try {
      // Release locks, close, and re-open with new settings
      isStreamOpen = false;
      if (streamReader) {
        try {
          await streamReader.cancel();
          streamReader.releaseLock();
        } catch {
          // Ignore release error
        }
        streamReader = null;
      }
      if (streamWriter) {
        try {
          streamWriter.releaseLock();
        } catch {
          // Ignore release error
        }
        streamWriter = null;
      }
      await activePort.value.close();
      await activePort.value.open(opts);
      currentConfig = { ...opts };
      pumpIncomingData();
      return 0; // DC_STATUS_SUCCESS
    } catch (err) {
      lastError.value = err?.message || "Failed to reconfigure serial port";
      return -6; // DC_STATUS_IO
    }
  }

  async function setDtr(value) {
    if (!activePort.value) return 0;
    try {
      await activePort.value.setSignals({ dataTerminalReady: Boolean(value) });
      return 0;
    } catch (err) {
      console.warn("[WebSerial] Failed or unsupported setDtr:", err?.message || err);
      // Return 0 so adapter without hardware handshake doesn't abort
      return 0;
    }
  }

  async function setRts(value) {
    if (!activePort.value) return 0;
    try {
      await activePort.value.setSignals({ requestToSend: Boolean(value) });
      return 0;
    } catch (err) {
      console.warn("[WebSerial] Failed or unsupported setRts:", err?.message || err);
      // Return 0 so adapter without hardware handshake doesn't abort
      return 0;
    }
  }

  async function setBreak(value) {
    if (!activePort.value) return 0;
    try {
      await activePort.value.setSignals({ break: Boolean(value) });
      return 0;
    } catch (err) {
      console.warn("[WebSerial] Failed or unsupported setBreak:", err?.message || err);
      return 0;
    }
  }

  function readBytes(destSubarray, size, timeoutMs = 3000) {
    if (!activePort.value || !isStreamOpen) {
      return Promise.resolve({ status: -6, bytesRead: 0 }); // -6 = DC_STATUS_IO
    }

    const available = totalBufferedBytes();
    if (available >= size) {
      let copied = 0;
      while (copied < size && readChunks.length > 0) {
        const chunk = readChunks[0];
        const needed = size - copied;
        if (chunk.length <= needed) {
          destSubarray.set(chunk, copied);
          copied += chunk.length;
          readChunks.shift();
        } else {
          destSubarray.set(chunk.subarray(0, needed), copied);
          readChunks[0] = chunk.subarray(needed);
          copied += needed;
        }
      }
      return Promise.resolve({ status: 0, bytesRead: size });
    }

    return new Promise((resolve, reject) => {
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const idx = readWaiters.findIndex((w) => w.timer === timer);
          if (idx !== -1) readWaiters.splice(idx, 1);
          resolve({ status: -7, bytesRead: 0 }); // -7 = DC_STATUS_TIMEOUT
        }, timeoutMs);
      }

      readWaiters.push({
        dest: destSubarray,
        size,
        timer,
        resolve,
        reject
      });
    });
  }

  async function writeBytes(srcSubarray, size) {
    if (!activePort.value || !activePort.value.writable) {
      return { status: -6, bytesWritten: 0 };
    }
    try {
      const writer = activePort.value.writable.getWriter();
      const chunk = srcSubarray.subarray(0, size);
      await writer.write(chunk);
      writer.releaseLock();
      return { status: 0, bytesWritten: size };
    } catch (err) {
      lastError.value = err?.message || "Failed to write bytes to serial port";
      return { status: -6, bytesWritten: 0 };
    }
  }

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function close() {
    isStreamOpen = false;
    currentConfig = null;
    resetBuffers();

    if (streamReader) {
      try {
        await streamReader.cancel();
        streamReader.releaseLock();
      } catch {
        // Ignore reader release error
      }
      streamReader = null;
    }

    if (streamWriter) {
      try {
        streamWriter.releaseLock();
      } catch {
        // Ignore writer release error
      }
      streamWriter = null;
    }

    if (activePort.value) {
      try {
        await activePort.value.close();
      } catch {
        // Ignore port close error
      }
      activePort.value = null;
    }

    isConnected.value = false;
    isReading.value = false;
    return 0;
  }

  return {
    isSupported,
    isConnected,
    isReading,
    lastError,
    activePort,
    requestPort,
    open,
    configure,
    setDtr,
    setRts,
    setBreak,
    readBytes,
    writeBytes,
    sleep,
    close
  };
}
