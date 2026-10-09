package store

import (
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
