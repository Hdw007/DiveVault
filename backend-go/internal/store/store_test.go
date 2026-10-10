package store

import (
	"encoding/json"
	"testing"
	"time"
)

func TestRedactDatabaseURL(t *testing.T) {
	cases := map[string]string{
		"postgresql://dive:secret@localhost:5432/dive": "postgresql://dive:***@localhost:5432/dive",
		"postgresql://localhost:5432/dive":            "postgresql://localhost:5432/dive",
		"":                                            "",
	}
	for input, expected := range cases {
		if got := RedactDatabaseURL(input); got != expected {
			t.Fatalf("RedactDatabaseURL(%q) = %q, expected %q", input, got, expected)
		}
	}
}

func TestAddMonths(t *testing.T) {
	cases := []struct {
		inputYear, inputMonth, inputDay int
		months                          int
		expYear, expMonth, expDay       int
	}{
		{2020, 1, 1, 12, 2021, 1, 1},
		{2020, 1, 31, 1, 2020, 2, 29}, // 2020 is leap year
		{2021, 1, 31, 1, 2021, 2, 28}, // 2021 is non-leap year
		{2020, 8, 31, 1, 2020, 9, 30},
		{2021, 1, 15, -12, 2020, 1, 15},
	}
	for _, c := range cases {
		d := addMonths(time.Date(c.inputYear, time.Month(c.inputMonth), c.inputDay, 0, 0, 0, 0, time.UTC), c.months)
		if d.Year() != c.expYear || int(d.Month()) != c.expMonth || d.Day() != c.expDay {
			t.Fatalf("addMonths(%d-%02d-%02d, %d) = %d-%02d-%02d, expected %d-%02d-%02d",
				c.inputYear, c.inputMonth, c.inputDay, c.months,
				d.Year(), d.Month(), d.Day(),
				c.expYear, c.expMonth, c.expDay)
		}
	}
}

func TestParseISODate(t *testing.T) {
	if got := parseISODate("2020-01-01"); got == nil || got.Format("2006-01-02") != "2020-01-01" {
		t.Fatalf("parseISODate(2020-01-01) = %v", got)
	}
	if got := parseISODate("2020-01-01T15:04:05Z"); got == nil || got.Format("2006-01-02") != "2020-01-01" {
		t.Fatalf("parseISODate(ISO) = %v", got)
	}
	if got := parseISODate(""); got != nil {
		t.Fatalf("parseISODate(empty) expected nil, got %v", got)
	}
	if got := parseISODate("invalid"); got != nil {
		t.Fatalf("parseISODate(invalid) expected nil, got %v", got)
	}
}

func TestEquipmentServiceStatusForDive(t *testing.T) {
	itemOverdue := map[string]any{
		"last_service_date":       "2020-01-01",
		"service_interval_months": 12,
	}
	status := equipmentServiceStatusForDive(itemOverdue, "2026-04-01")
	if status["service_status"] != "overdue" {
		t.Fatalf("expected overdue, got %v", status["service_status"])
	}
	if status["service_due_date"] != "2021-01-01" {
		t.Fatalf("expected 2021-01-01, got %v", status["service_due_date"])
	}

	itemServiced := map[string]any{
		"last_service_date":       "2026-01-01",
		"service_interval_months": 12,
	}
	statusServiced := equipmentServiceStatusForDive(itemServiced, "2026-02-01")
	if statusServiced["service_status"] != "serviced" {
		t.Fatalf("expected serviced, got %v", statusServiced["service_status"])
	}

	statusDueSoon := equipmentServiceStatusForDive(itemServiced, "2026-12-15")
	if statusDueSoon["service_status"] != "due_soon" {
		t.Fatalf("expected due_soon, got %v", statusDueSoon["service_status"])
	}

	itemMissing := map[string]any{}
	statusMissing := equipmentServiceStatusForDive(itemMissing, "2026-04-01")
	if statusMissing["service_status"] != "unknown" {
		t.Fatalf("expected unknown, got %v", statusMissing["service_status"])
	}
}

func TestEquipmentServiceSummary(t *testing.T) {
	itemOverdue := map[string]any{
		"is_standard":              true,
		"last_service_dive_count":  5,
		"max_dives_before_service": 50,
		"next_service_due":         "2020-01-01",
	}
	summary := equipmentServiceSummary(itemOverdue, 20, "2020-01-01")
	if summary["dives_since_service"] != 15 {
		t.Fatalf("expected 15 dives since service, got %v", summary["dives_since_service"])
	}
	if summary["dives_remaining_before_service"] != 35 {
		t.Fatalf("expected 35 dives remaining, got %v", summary["dives_remaining_before_service"])
	}
	if summary["service_due"] != true {
		t.Fatalf("expected service_due true, got %v", summary["service_due"])
	}
	if summary["service_due_reason"] != "date" {
		t.Fatalf("expected service_due_reason date, got %v", summary["service_due_reason"])
	}

	// Max dives exceeded
	summaryDiveDue := equipmentServiceSummary(itemOverdue, 60, "2099-01-01")
	if summaryDiveDue["service_due"] != true {
		t.Fatalf("expected service_due true, got %v", summaryDiveDue["service_due"])
	}
	if summaryDiveDue["service_due_reason"] != "dives" {
		t.Fatalf("expected service_due_reason dives, got %v", summaryDiveDue["service_due_reason"])
	}
}

func TestUpdateTanksFromPayload(t *testing.T) {
	// Case 1: Update existing tank pressures and volume from string payload
	fields := map[string]any{
		"tanks": []any{
			map[string]any{
				"volume":            12.0,
				"beginpressure_bar": 200.0,
				"endpressure_bar":   50.0,
			},
		},
	}
	payload := map[string]any{
		"tank_volume_l":      "15",
		"begin_pressure_bar": "210",
		"end_pressure_bar":   "60",
	}
	updateTanksFromPayload(fields, payload)
	tanks := fields["tanks"].([]any)
	if len(tanks) != 1 {
		t.Fatalf("expected 1 tank, got %d", len(tanks))
	}
	tank0 := tanks[0].(map[string]any)
	if tank0["volume"] != 15.0 {
		t.Errorf("expected volume 15.0, got %v", tank0["volume"])
	}
	if tank0["beginpressure_bar"] != 210.0 || tank0["begin_pressure_bar"] != 210.0 {
		t.Errorf("expected beginpressure_bar 210.0, got %v", tank0["beginpressure_bar"])
	}
	if tank0["endpressure_bar"] != 60.0 || tank0["end_pressure_bar"] != 60.0 {
		t.Errorf("expected endpressure_bar 60.0, got %v", tank0["endpressure_bar"])
	}

	// Case 2: Create tank when none existed
	emptyFields := map[string]any{}
	updateTanksFromPayload(emptyFields, map[string]any{
		"begin_pressure_bar": 205.0,
		"end_pressure_bar":   45.0,
	})
	createdTanks := emptyFields["tanks"].([]any)
	if len(createdTanks) != 1 {
		t.Fatalf("expected 1 created tank, got %d", len(createdTanks))
	}
	createdTank0 := createdTanks[0].(map[string]any)
	if createdTank0["beginpressure_bar"] != 205.0 {
		t.Errorf("expected beginpressure_bar 205.0, got %v", createdTank0["beginpressure_bar"])
	}
	if createdTank0["endpressure_bar"] != 45.0 {
		t.Errorf("expected endpressure_bar 45.0, got %v", createdTank0["endpressure_bar"])
	}

	// Case 3: Payload without tank keys leaves tanks untouched
	originalFields := map[string]any{
		"tanks": []any{
			map[string]any{"volume": 10.0},
		},
	}
	updateTanksFromPayload(originalFields, map[string]any{
		"logbook": map[string]any{"notes": "just notes"},
	})
	tanksUnchanged := originalFields["tanks"].([]any)
	if len(tanksUnchanged) != 1 || tanksUnchanged[0].(map[string]any)["volume"] != 10.0 {
		t.Errorf("expected tanks untouched, got %v", tanksUnchanged)
	}
}

func TestDiverStatsJSONSerialization(t *testing.T) {
	stats := DiverStats{
		TotalDives:             12,
		TotalSeconds:           36000,
		TotalHours:             10.0,
		MaxDepth:               28.5,
		TotalBarConsumed:       1500,
		AverageDurationSeconds: 3000.0,
		AverageMaxDepth:        22.1,
		BottomTimeProgress:     10,
		ImportedCount:          3,
	}

	data, err := json.Marshal(stats)
	if err != nil {
		t.Fatalf("marshal DiverStats failed: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal DiverStats failed: %v", err)
	}

	if parsed["totalDives"] != float64(12) {
		t.Errorf("expected totalDives=12, got %v", parsed["totalDives"])
	}
	if parsed["totalSeconds"] != float64(36000) {
		t.Errorf("expected totalSeconds=36000, got %v", parsed["totalSeconds"])
	}
	if parsed["totalHours"] != 10.0 {
		t.Errorf("expected totalHours=10.0, got %v", parsed["totalHours"])
	}
	if parsed["maxDepth"] != 28.5 {
		t.Errorf("expected maxDepth=28.5, got %v", parsed["maxDepth"])
	}
	if parsed["totalBarConsumed"] != float64(1500) {
		t.Errorf("expected totalBarConsumed=1500, got %v", parsed["totalBarConsumed"])
	}
	if parsed["importedCount"] != float64(3) {
		t.Errorf("expected importedCount=3, got %v", parsed["importedCount"])
	}
}

func TestGetDiverStatsNilDB(t *testing.T) {
	var db *DB
	stats, err := db.GetDiverStats(nil, "user-1")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if stats == nil || stats.TotalDives != 0 {
		t.Fatalf("expected empty stats with TotalDives=0, got %v", stats)
	}
}

