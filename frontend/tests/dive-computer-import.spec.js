import { expect, test } from "@playwright/test";

import { gotoAndWait, installAppMocks } from "./helpers/app-fixtures.js";

function setupMockWebSerial(page, mockDownloadResult = null) {
  return page.addInitScript((mockResult) => {
    const mockPort = {
      open: async () => {},
      close: async () => {},
      setSignals: async () => {},
      readable: {
        getReader: () => ({
          read: async () => ({ value: null, done: true }),
          releaseLock: () => {},
          cancel: async () => {}
        })
      },
      writable: {
        getWriter: () => ({
          write: async () => {},
          releaseLock: () => {}
        })
      }
    };

    const mockSerial = {
      requestPort: async () => mockPort,
      getPorts: async () => [mockPort]
    };

    Object.defineProperty(Navigator.prototype, "serial", {
      get: () => mockSerial,
      configurable: true
    });

    if (mockResult) {
      window.__testMockDownloadDives = async ({ onProgress }) => {
        if (onProgress) {
          onProgress({ stage: "connecting", current: 0, total: 100 });
          onProgress({ stage: "reading", current: 50, total: 100 });
          onProgress({ stage: "reading", current: 100, total: 100 });
        }
        return mockResult;
      };
    }
  }, mockDownloadResult);
}

test("shows browser compatibility guidance when Web Serial is unsupported", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "serial", {
      get: () => undefined,
      configurable: true
    });
  });
  await installAppMocks(page);
  await gotoAndWait(page, "/#imports");

  await page.getByRole("button", { name: "Import from Dive Computer" }).first().click();

  await expect(page.getByRole("heading", { name: "Connect Dive Computer" })).toBeVisible();
  await expect(page.locator("text=Web Serial API is not supported in this browser environment")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect & Download Dives" })).toBeDisabled();

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Connect Dive Computer" })).not.toBeVisible();
});

test("allows launching dive computer import from Settings > Data Management", async ({ page }) => {
  await installAppMocks(page);
  await gotoAndWait(page, "/#settings");

  await page.getByRole("button", { name: "Data Management" }).first().click();
  await page.getByRole("button", { name: /Direct Dive Computer Import/i }).click();
  await expect(page.getByRole("heading", { name: "Connect Dive Computer" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Connect Dive Computer" })).not.toBeVisible();
});

test("lists supported dive computer models loaded from libdivecomputer Wasm", async ({ page }) => {
  await setupMockWebSerial(page);
  await installAppMocks(page);
  await gotoAndWait(page, "/#imports");

  await page.getByRole("button", { name: "Import from Dive Computer" }).first().click();

  await expect(page.getByRole("heading", { name: "Connect Dive Computer" })).toBeVisible();
  await expect(page.locator("text=Ready to Connect")).toBeVisible();

  // Verify manufacturer selector contains Uwatec, Suunto, Mares, Cressi
  const vendorSelect = page.locator("select").first();
  await expect(vendorSelect).toBeVisible();
  await expect(vendorSelect).toContainText("Uwatec");
  await expect(vendorSelect).toContainText("Suunto");
  await expect(vendorSelect).toContainText("Mares");
  await expect(vendorSelect).toContainText("Cressi");

  // Model select
  const productSelect = page.locator("select").nth(1);
  await vendorSelect.selectOption("Uwatec");
  await expect(productSelect).toContainText("Aladin Air");

  // Switch to Suunto and verify models update
  await vendorSelect.selectOption("Suunto");
  await expect(productSelect).toContainText("Vyper");

  // Switch back to Uwatec
  await vendorSelect.selectOption("Uwatec");
  await expect(productSelect).toContainText("Aladin Air Twin");
  await productSelect.selectOption("Aladin Air Twin");

  await expect(page.getByRole("button", { name: "Connect & Download Dives" })).toBeEnabled();

  await page.getByRole("button", { name: "Close" }).click();
});

test("executes end-to-end import flow from dive computer into the import queue", async ({ page }) => {
  const mockDiveResult = {
    status: 0,
    latestFingerprint: "01020304",
    dives: [
      {
        vendor: "Uwatec",
        product: "Aladin Air",
        dive_uid: "Uwatec:Aladin Air:01020304",
        fingerprint_hex: "01020304",
        started_at: "2026-03-25T14:30:00Z",
        duration_seconds: 2820,
        max_depth_m: 23.4,
        avg_depth_m: 15.1,
        fields: {},
        raw_sha256: "raw-sha-aladin-playwright-1",
        raw_data_b64: "AQIDBA==",
        samples: [
          { time_seconds: 0, depth_m: 0, temperature_c: 26, tank_pressure_bar: { primary: 200 } },
          { time_seconds: 1400, depth_m: 23.4, temperature_c: 24, tank_pressure_bar: { primary: 120 } },
          { time_seconds: 2820, depth_m: 0, temperature_c: 26, tank_pressure_bar: { primary: 50 } }
        ]
      }
    ]
  };

  await setupMockWebSerial(page, mockDiveResult);
  await installAppMocks(page);
  await gotoAndWait(page, "/#imports");

  await page.getByRole("button", { name: "Import from Dive Computer" }).first().click();
  await expect(page.getByRole("heading", { name: "Connect Dive Computer" })).toBeVisible();

  // Click Connect & Download Dives
  await page.getByRole("button", { name: "Connect & Download Dives" }).click();

  // Verify transition to preview stage
  await expect(page.getByRole("heading", { name: "Discovered Dives" })).toBeVisible();
  await expect(page.locator("text=Found 1 dive ready to import")).toBeVisible();
  await expect(page.locator("td:text('23.4 m')")).toBeVisible();

  // Click Import 1 Dives
  await page.getByRole("button", { name: "Import 1 Dives" }).click();

  // Verify completion screen
  await expect(page.getByRole("heading", { name: "Import Complete!" })).toBeVisible();
  await expect(page.locator("text=1 new dive imported into the review queue.")).toBeVisible();

  // Click Done
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Connect Dive Computer" })).not.toBeVisible();

  // Verify imported dive is present in the review list
  await expect(page.locator("div:visible").filter({ hasText: "Uwatec" }).first()).toBeVisible();
});

test("allows selecting specific dives via checkboxes before importing", async ({ page }) => {
  const mockDivesResult = {
    status: 0,
    latestFingerprint: "01020305",
    dives: [
      {
        vendor: "Uwatec",
        product: "Aladin Air",
        dive_uid: "Uwatec:Aladin Air:dive-1",
        started_at: "2026-03-25T14:30:00Z",
        duration_seconds: 1800,
        max_depth_m: 18.5,
        avg_depth_m: 12.0,
        fields: {},
        raw_sha256: "raw-sha-1",
        raw_data_b64: "AQID",
        samples: []
      },
      {
        vendor: "Uwatec",
        product: "Aladin Air",
        dive_uid: "Uwatec:Aladin Air:dive-2",
        started_at: "2026-03-24T10:00:00Z",
        duration_seconds: 2400,
        max_depth_m: 25.0,
        avg_depth_m: 16.0,
        fields: {},
        raw_sha256: "raw-sha-2",
        raw_data_b64: "BAUG",
        samples: []
      }
    ]
  };

  await setupMockWebSerial(page, mockDivesResult);
  await installAppMocks(page);
  await gotoAndWait(page, "/#imports");

  await page.getByRole("button", { name: "Import from Dive Computer" }).first().click();
  await page.getByRole("button", { name: "Connect & Download Dives" }).click();

  await expect(page.getByRole("heading", { name: "Discovered Dives" })).toBeVisible();
  await expect(page.locator("text=2 of 2 Selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import 2 Dives" })).toBeVisible();

  // Uncheck the first dive by clicking its checkbox
  const checkboxes = page.locator("tbody input[type='checkbox']");
  await checkboxes.first().uncheck();

  await expect(page.locator("text=1 of 2 Selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import 1 Dives" })).toBeVisible();

  // Click Import 1 Dives
  await page.getByRole("button", { name: "Import 1 Dives" }).click();

  // Verify only 1 dive was processed
  await expect(page.getByRole("heading", { name: "Import Complete!" })).toBeVisible();
  await expect(page.locator("text=1 new dive imported into the review queue.")).toBeVisible();

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Connect Dive Computer" })).not.toBeVisible();
});
