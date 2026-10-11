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
  let logCallback = null;

  function setLogCallback(fn) {
    logCallback = fn;
  }

  function emitLog(msg) {
    if (typeof logCallback === "function") {
      logCallback("serial", msg);
    }
  }

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

    isStreamOpen = true;

    (async () => {
      while (isStreamOpen && activePort.value && activePort.value.readable) {
        try {
          streamReader = activePort.value.readable.getReader();
        } catch (err) {
          lastError.value = err?.message || "Failed to acquire serial stream reader";
          emitLog(`Failed to acquire serial stream reader: ${err?.message || err}`);
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }

        try {
          while (isStreamOpen && activePort.value) {
            const { value, done } = await streamReader.read();
            if (done) {
              emitLog("Serial stream reader closed (done=true)");
              isStreamOpen = false;
              break;
            }
            if (value && value.length > 0) {
              const hex = Array.from(value.subarray(0, Math.min(value.length, 24)))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(" ");
              emitLog(
                `RX ${value.length} byte(s): [${hex}${value.length > 24 ? "..." : ""}] (buffered total: ${totalBufferedBytes() + value.length})`
              );
              readChunks.push(value);
              checkWaiters();
            }
          }
        } catch (err) {
          // Recoverable hardware signal errors (such as framing or break on wet contacts)
          emitLog(`Stream error (${err?.name}): ${err?.message} - attempting auto-recovery`);
          console.warn("[WebSerial] Recoverable stream read error:", err?.name, err?.message);
          await new Promise((r) => setTimeout(r, 20));
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
      emitLog("Requesting serial port from browser dialog...");
      const port = await navigator.serial.requestPort(filters.length ? { filters } : {});
      activePort.value = port;
      const info = port.getInfo ? port.getInfo() : {};
      const vid = info.usbVendorId ? `0x${info.usbVendorId.toString(16).padStart(4, "0")}` : "unknown";
      const pid = info.usbProductId ? `0x${info.usbProductId.toString(16).padStart(4, "0")}` : "unknown";
      emitLog(`Serial port selected (USB VID: ${vid}, PID: ${pid})`);
      return port;
    } catch (err) {
      if (err.name === "NotFoundError") {
        emitLog("User cancelled port selection dialog");
        throw new Error("No serial port selected", { cause: err });
      }
      emitLog(`Error selecting serial port: ${err?.message || err}`);
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

    emitLog(
      `Opening serial port at ${serialOptions.baudRate} baud, ${serialOptions.dataBits}${serialOptions.parity[0].toUpperCase()}${serialOptions.stopBits}...`
    );
    resetBuffers();

    try {
      await activePort.value.open(serialOptions);
      currentConfig = { ...serialOptions };
      // Assert DTR line to power interface cable (such as Aladin stolen-power circuit)
      try {
        await activePort.value.setSignals({ dataTerminalReady: true, requestToSend: false });
        emitLog("Port opened successfully. DTR asserted (+12V/high for cable power).");
      } catch (sigErr) {
        emitLog(`Port opened. DTR signal warning: ${sigErr?.message || sigErr}`);
        console.warn("[WebSerial] Could not assert initial DTR/RTS signals:", sigErr);
      }
      isConnected.value = true;
      pumpIncomingData();
    } catch (err) {
      lastError.value = err?.message || "Failed to open serial port";
      emitLog(`Failed to open serial port: ${err?.message || err}`);
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

    if (!activePort.value) {
      emitLog("configure() failed: no active port");
      return -6; // DC_STATUS_IO
    }

    // Skip redundant reconnection if already configured with matching parameters
    const isSameConfig =
      currentConfig &&
      currentConfig.baudRate === opts.baudRate &&
      currentConfig.dataBits === opts.dataBits &&
      currentConfig.parity === opts.parity &&
      currentConfig.stopBits === opts.stopBits &&
      currentConfig.flowControl === opts.flowControl;

    if (isSameConfig && isConnected.value && isStreamOpen) {
      emitLog(`Serial port already configured: ${opts.baudRate} baud, ${opts.dataBits}${opts.parity[0].toUpperCase()}${opts.stopBits}`);
      return 0; // DC_STATUS_SUCCESS
    }

    emitLog(`Reconfiguring serial port: ${opts.baudRate} baud, ${opts.dataBits}${opts.parity[0].toUpperCase()}${opts.stopBits}...`);

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
      emitLog("Serial port reconfigured successfully.");
      return 0; // DC_STATUS_SUCCESS
    } catch (err) {
      lastError.value = err?.message || "Failed to reconfigure serial port";
      emitLog(`Failed to reconfigure serial port: ${err?.message || err}`);
      return -6; // DC_STATUS_IO
    }
  }

  async function setDtr(value) {
    if (!activePort.value) return 0;
    try {
      emitLog(`Setting DTR=${Boolean(value)}`);
      await activePort.value.setSignals({ dataTerminalReady: Boolean(value) });
      return 0;
    } catch (err) {
      emitLog(`Warning setting DTR: ${err?.message || err}`);
      console.warn("[WebSerial] Failed or unsupported setDtr:", err?.message || err);
      // Return 0 so adapter without hardware handshake doesn't abort
      return 0;
    }
  }

  async function setRts(value) {
    if (!activePort.value) return 0;
    try {
      emitLog(`Setting RTS=${Boolean(value)}`);
      await activePort.value.setSignals({ requestToSend: Boolean(value) });
      return 0;
    } catch (err) {
      emitLog(`Warning setting RTS: ${err?.message || err}`);
      console.warn("[WebSerial] Failed or unsupported setRts:", err?.message || err);
      // Return 0 so adapter without hardware handshake doesn't abort
      return 0;
    }
  }

  async function setBreak(value) {
    if (!activePort.value) return 0;
    try {
      emitLog(`Setting Break=${Boolean(value)}`);
      await activePort.value.setSignals({ break: Boolean(value) });
      return 0;
    } catch (err) {
      console.warn("[WebSerial] Failed or unsupported setBreak:", err?.message || err);
      return 0;
    }
  }

  function readBytes(destSubarray, size, timeoutMs = 3000) {
    if (!activePort.value || !isStreamOpen) {
      emitLog(`readBytes(${size}) failed: port not open`);
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
          emitLog(`readBytes timeout (${timeoutMs}ms) waiting for ${size} bytes (currently buffered: ${totalBufferedBytes()})`);
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
      emitLog(`writeBytes(${size}) failed: port not writable`);
      return { status: -6, bytesWritten: 0 };
    }
    try {
      const writer = activePort.value.writable.getWriter();
      const chunk = srcSubarray.subarray(0, size);
      const hex = Array.from(chunk.subarray(0, Math.min(size, 16)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      emitLog(`TX ${size} byte(s): [${hex}${size > 16 ? "..." : ""}]`);
      await writer.write(chunk);
      writer.releaseLock();
      return { status: 0, bytesWritten: size };
    } catch (err) {
      lastError.value = err?.message || "Failed to write bytes to serial port";
      emitLog(`TX error: ${err?.message || err}`);
      return { status: -6, bytesWritten: 0 };
    }
  }

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function close() {
    emitLog("Closing serial port...");
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
    emitLog("Serial port closed.");
    return 0;
  }

  return {
    isSupported,
    isConnected,
    isReading,
    lastError,
    activePort,
    setLogCallback,
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
