package store

import (
	"strings"
	"testing"
)

func TestBuildProfileCollectionUpsertSQL(t *testing.T) {
	table := "user_profile_dive_sites"
	idColumn := "site_id"
	columns := []string{"name", "location", "country", "latitude", "longitude"}

	names := []string{"user_id", idColumn}
	placeholders := []string{"$1", "$2"}
	updateClauses := make([]string, 0, len(columns))
	argsCount := 2

	for _, column := range columns {
		argsCount++
		names = append(names, column)
		placeholders = append(placeholders, strings.Replace("$X", "X", string(rune('0'+argsCount)), 1))
		updateClauses = append(updateClauses, column+" = EXCLUDED."+column)
	}

	query := "INSERT INTO " + table + " (" + strings.Join(names, ", ") + ") VALUES (" + strings.Join(placeholders, ", ") + ") ON CONFLICT (user_id, " + idColumn + ") DO UPDATE SET " + strings.Join(updateClauses, ", ")

	if !strings.Contains(query, "ON CONFLICT (user_id, site_id) DO UPDATE SET") {
		t.Fatalf("expected conflict target, got: %s", query)
	}
	if !strings.Contains(query, "name = EXCLUDED.name") {
		t.Fatalf("expected EXCLUDED clause, got: %s", query)
	}
	if !strings.Contains(query, "longitude = EXCLUDED.longitude") {
		t.Fatalf("expected EXCLUDED longitude, got: %s", query)
	}
}

func TestDiveTelemetrySampleCountFallback(t *testing.T) {
	diveWithCount := Dive{
		ID:          1,
		SampleCount: 120,
		Samples:     nil, // omitted on list query
	}
	if diveWithCount.SampleCount != 120 {
		t.Fatalf("expected SampleCount to be preserved, got %d", diveWithCount.SampleCount)
	}
	if diveWithCount.Samples != nil {
		t.Fatalf("expected Samples to remain nil when omitted")
	}
}

