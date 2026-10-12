package httpapi

import (
	"archive/zip"
	"bytes"
	"testing"
	"time"

	"github.com/jlemmings/divevault/backend/internal/store"
)

func TestSafeBackupPathRejectsTraversal(t *testing.T) {
	for _, path := range []string{"../backup.json", "/backup.json", `licenses\..\backup.json`} {
		if safeBackupPath(path) {
			t.Fatalf("expected unsafe path %q to be rejected", path)
		}
	}
	if !safeBackupPath("licenses/license-1/card.pdf") {
		t.Fatalf("expected normal relative path to be accepted")
	}
}

func TestFixedWindowLimiterRejectsAfterLimit(t *testing.T) {
	limiter := newFixedWindowLimiter()
	if ok, _ := limiter.Allow("key", 2, 60); !ok {
		t.Fatalf("first request rejected")
	}
	if ok, _ := limiter.Allow("key", 2, 60); !ok {
		t.Fatalf("second request rejected")
	}
	if ok, retryAfter := limiter.Allow("key", 2, 60); ok || retryAfter <= 0 {
		t.Fatalf("third request ok=%v retryAfter=%d", ok, retryAfter)
	}
}

func TestFixedWindowLimiterResets(t *testing.T) {
	limiter := newFixedWindowLimiter()
	if ok, _ := limiter.Allow("key", 1, 1); !ok {
		t.Fatalf("first request rejected")
	}
	time.Sleep(1100 * time.Millisecond)
	if ok, _ := limiter.Allow("key", 1, 1); !ok {
		t.Fatalf("request after reset rejected")
	}
}

func TestReadBackupZIPPayloadRejectsMissingManifest(t *testing.T) {
	body := zipBody(t, map[string]string{"licenses/license-1/card.pdf": `%PDF-1.4`})
	_, err := readBackupZIPPayload(body, 1024)
	if err == nil || err.Error() != "Backup archive is missing backup.json" {
		t.Fatalf("expected missing manifest error, got %v", err)
	}
}

func TestReadBackupZIPPayloadRejectsDuplicateMembers(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	first, _ := writer.Create("backup.json")
	_, _ = first.Write([]byte(`{"version":1}`))
	second, _ := writer.Create("backup.json")
	_, _ = second.Write([]byte(`{"version":1}`))
	_ = writer.Close()

	_, err := readBackupZIPPayload(buffer.Bytes(), 1024)
	if err == nil || err.Error() != `Backup archive contains duplicate path "backup.json"` {
		t.Fatalf("expected duplicate member error, got %v", err)
	}
}

func TestReadBackupZIPPayloadHydratesLicenseDocumentFile(t *testing.T) {
	body := zipBody(t, map[string]string{
		"backup.json":            `{"version":1,"license_documents":[{"license_id":"license-1","filename":"card.pdf","content_type":"application/pdf","file_path":"licenses/license-1/card.pdf"}]}`,
		"licenses/license-1/card.pdf": "%PDF-1.4\n",
	})
	payload, err := readBackupZIPPayload(body, 1024)
	if err != nil {
		t.Fatalf("readBackupZIPPayload returned error: %v", err)
	}
	documents, _ := payload["license_documents"].([]any)
	if len(documents) != 1 {
		t.Fatalf("license document count = %d, expected 1", len(documents))
	}
	document, _ := documents[0].(map[string]any)
	if document["data_b64"] != "JVBERi0xLjQK" {
		t.Fatalf("data_b64 = %v", document["data_b64"])
	}
}

func TestReadBackupZIPPayloadRejectsUnexpectedMember(t *testing.T) {
	body := zipBody(t, map[string]string{
		"backup.json": `{"version":1}`,
		"tmp.txt":     "no",
	})
	_, err := readBackupZIPPayload(body, 1024)
	if err == nil || err.Error() != `Backup archive contains unexpected path "tmp.txt"` {
		t.Fatalf("expected unexpected path error, got %v", err)
	}
}

func TestValidateBackupPayloadRequiresDiveRawData(t *testing.T) {
	err := validateBackupPayload(map[string]any{
		"version": float64(1),
		"dives": []any{
			map[string]any{"vendor": "v", "product": "p", "dive_uid": "dive-1", "raw_sha256": "abc"},
		},
	})
	if err == nil || err.Error() != "Backup dive 1 is missing required fields: raw_data_b64" {
		t.Fatalf("expected raw_data_b64 validation error, got %v", err)
	}
}

func zipBody(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, body := range entries {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create zip member: %v", err)
		}
		if _, err := file.Write([]byte(body)); err != nil {
			t.Fatalf("write zip member: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buffer.Bytes()
}

func TestSummarizeDivesCalculatesTotalsAndAverages(t *testing.T) {
	dur1 := int64(1800)
	dur2 := int64(2400)
	depth1 := 18.0
	depth2 := 24.0

	dives := []store.Dive{
		{
			DurationSeconds: &dur1,
			MaxDepthM:       &depth1,
			Fields: map[string]any{
				"tanks": []any{
					map[string]any{"beginpressure_bar": 200.0, "endpressure_bar": 130.0},
				},
			},
		},
		{
			DurationSeconds: &dur2,
			MaxDepthM:       &depth2,
			Samples: []any{
				map[string]any{"tank_pressure_bar": map[string]any{"0": 190.0}},
				map[string]any{"tank_pressure_bar": map[string]any{"0": 120.0}},
			},
		},
	}

	summary := summarizeDives(dives)

	if summary["totalDives"] != 2 {
		t.Errorf("expected totalDives=2, got %v", summary["totalDives"])
	}
	if summary["totalSeconds"] != int64(4200) {
		t.Errorf("expected totalSeconds=4200, got %v", summary["totalSeconds"])
	}
	if summary["totalHours"] != 1.2 {
		t.Errorf("expected totalHours=1.2, got %v", summary["totalHours"])
	}
	if summary["maxDepth"] != 24.0 {
		t.Errorf("expected maxDepth=24.0, got %v", summary["maxDepth"])
	}
	if summary["totalBarConsumed"] != 140 {
		t.Errorf("expected totalBarConsumed=140, got %v", summary["totalBarConsumed"])
	}
	if summary["averageDurationSeconds"] != 2100.0 {
		t.Errorf("expected averageDurationSeconds=2100.0, got %v", summary["averageDurationSeconds"])
	}
	if summary["averageMaxDepth"] != 21.0 {
		t.Errorf("expected averageMaxDepth=21.0, got %v", summary["averageMaxDepth"])
	}
	if summary["bottomTimeProgress"] != 1 {
		t.Errorf("expected bottomTimeProgress=1, got %v", summary["bottomTimeProgress"])
	}
}

func TestSummarizeDivesEmpty(t *testing.T) {
	summary := summarizeDives([]store.Dive{})

	if summary["totalDives"] != 0 {
		t.Errorf("expected totalDives=0, got %v", summary["totalDives"])
	}
	if summary["totalSeconds"] != int64(0) {
		t.Errorf("expected totalSeconds=0, got %v", summary["totalSeconds"])
	}
	if summary["totalHours"] != 0.0 {
		t.Errorf("expected totalHours=0.0, got %v", summary["totalHours"])
	}
	if summary["maxDepth"] != 0.0 {
		t.Errorf("expected maxDepth=0.0, got %v", summary["maxDepth"])
	}
	if summary["totalBarConsumed"] != 0 {
		t.Errorf("expected totalBarConsumed=0, got %v", summary["totalBarConsumed"])
	}
	if summary["averageDurationSeconds"] != 0.0 {
		t.Errorf("expected averageDurationSeconds=0.0, got %v", summary["averageDurationSeconds"])
	}
	if summary["averageMaxDepth"] != 0.0 {
		t.Errorf("expected averageMaxDepth=0.0, got %v", summary["averageMaxDepth"])
	}
	if summary["bottomTimeProgress"] != 0 {
		t.Errorf("expected bottomTimeProgress=0, got %v", summary["bottomTimeProgress"])
	}
}

func TestSummarizeDivesDurationMSAndSamplePressureDirect(t *testing.T) {
	durMS := int64(3600000)
	depth := 15.5

	dives := []store.Dive{
		{
			DurationMS: &durMS,
			MaxDepthM:  &depth,
			Samples: []any{
				map[string]any{"tank_pressure_bar": 210.0},
				map[string]any{"tank_pressure_bar": 150.0},
			},
		},
	}

	summary := summarizeDives(dives)
	if summary["totalDives"] != 1 {
		t.Errorf("expected totalDives=1, got %v", summary["totalDives"])
	}
	if summary["totalSeconds"] != int64(3600) {
		t.Errorf("expected totalSeconds=3600, got %v", summary["totalSeconds"])
	}
	if summary["totalHours"] != 1.0 {
		t.Errorf("expected totalHours=1.0, got %v", summary["totalHours"])
	}
	if summary["maxDepth"] != 15.5 {
		t.Errorf("expected maxDepth=15.5, got %v", summary["maxDepth"])
	}
	if summary["totalBarConsumed"] != 60 {
		t.Errorf("expected totalBarConsumed=60, got %v", summary["totalBarConsumed"])
	}
}

func TestIsLogbookComplete(t *testing.T) {
	completeDive := store.Dive{
		Fields: map[string]any{
			"logbook": map[string]any{"status": "complete"},
		},
	}
	if !isLogbookComplete(completeDive) {
		t.Errorf("expected completeDive to be complete")
	}

	importedDive := store.Dive{
		Fields: map[string]any{
			"logbook": map[string]any{"status": "imported"},
		},
	}
	if isLogbookComplete(importedDive) {
		t.Errorf("expected importedDive not to be complete")
	}

	nilFieldsDive := store.Dive{}
	if isLogbookComplete(nilFieldsDive) {
		t.Errorf("expected nilFieldsDive not to be complete")
	}
}

func TestDivePressureRangeAlternativeFieldNames(t *testing.T) {
	dive := store.Dive{
		Fields: map[string]any{
			"tanks": []any{
				map[string]any{
					"begin_pressure_bar": 205.0,
					"end_pressure_bar":   45.0,
				},
			},
		},
	}
	begin, end := divePressureRange(dive)
	if begin == nil || end == nil || *begin != 205.0 || *end != 45.0 {
		t.Errorf("expected begin=205.0, end=45.0, got begin=%v end=%v", begin, end)
	}
}

