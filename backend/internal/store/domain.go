package store

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type DiverStats struct {
	TotalDives             int     `json:"totalDives"`
	TotalSeconds           int64   `json:"totalSeconds"`
	TotalHours             float64 `json:"totalHours"`
	MaxDepth               float64 `json:"maxDepth"`
	TotalBarConsumed       int     `json:"totalBarConsumed"`
	AverageDurationSeconds float64 `json:"averageDurationSeconds"`
	AverageMaxDepth        float64 `json:"averageMaxDepth"`
	BottomTimeProgress     int     `json:"bottomTimeProgress"`
	ImportedCount          int     `json:"importedCount"`
}

type DeviceState struct {
	UserID         string  `json:"user_id,omitempty"`
	Vendor         string  `json:"vendor"`
	Product        string  `json:"product"`
	FingerprintHex *string `json:"fingerprint_hex"`
	UpdatedAt      string  `json:"updated_at"`
}

type Dive struct {
	ID              int64          `json:"id"`
	UserID          string         `json:"user_id,omitempty"`
	Vendor          string         `json:"vendor"`
	Product         string         `json:"product"`
	FingerprintHex  *string        `json:"fingerprint_hex"`
	DiveUID         string         `json:"dive_uid"`
	StartedAt       *string        `json:"started_at"`
	DurationSeconds *int64         `json:"duration_seconds"`
	DurationMS      *int64         `json:"duration_ms,omitempty"`
	MaxDepthM       *float64       `json:"max_depth_m"`
	AvgDepthM       *float64       `json:"avg_depth_m"`
	ImportPayload   map[string]any `json:"import_payload"`
	Fields          map[string]any `json:"fields"`
	RawSHA256       string         `json:"raw_sha256"`
	RawDataB64      string         `json:"raw_data_b64,omitempty"`
	Samples         []any          `json:"samples,omitempty"`
	SampleCount     int            `json:"sample_count"`
	ImportedAt      string         `json:"imported_at"`
}

func (db *DB) GetDeviceState(ctx context.Context, userID string, vendor string, product string) (DeviceState, error) {
	state := DeviceState{UserID: cleanText(userID), Vendor: cleanText(vendor), Product: cleanText(product), UpdatedAt: ""}
	err := db.pool.QueryRow(ctx, `
        SELECT fingerprint_hex, updated_at FROM device_state
        WHERE user_id=$1 AND vendor=$2 AND product=$3
    `, state.UserID, state.Vendor, state.Product).Scan(&state.FingerprintHex, &state.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return state, nil
	}
	return state, err
}

func (db *DB) SaveDeviceState(ctx context.Context, userID string, vendor string, product string, fingerprintHex *string) error {
	_, err := db.pool.Exec(ctx, `
        INSERT INTO device_state(user_id, vendor, product, fingerprint_hex, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, vendor, product)
        DO UPDATE SET fingerprint_hex=excluded.fingerprint_hex, updated_at=excluded.updated_at
    `, cleanText(userID), cleanText(vendor), cleanText(product), fingerprintHex, nowISO())
	return err
}

func (db *DB) InsertDiveRecord(ctx context.Context, userID string, payload map[string]any) (bool, error) {
	rawB64, _ := payload["raw_data_b64"].(string)
	rawData, err := base64.StdEncoding.DecodeString(rawB64)
	if err != nil {
		return false, errors.New("raw_data_b64 must be valid base64")
	}
	fields := mapValue(payload["fields"])
	samples := sliceValue(payload["samples"])
	importPayload := cloneMap(payload)
	delete(importPayload, "raw_data_b64")
	if _, ok := importPayload["fields"]; !ok {
		importPayload["fields"] = fields
	}
	if _, ok := importPayload["samples"]; !ok {
		importPayload["samples"] = samples
	}
	fieldsJSON, _ := json.Marshal(fields)
	samplesJSON, _ := json.Marshal(samples)
	importJSON, _ := json.Marshal(importPayload)
	vendor := stringValue(payload["vendor"])
	product := stringValue(payload["product"])
	diveUID := stringValue(payload["dive_uid"])
	rawSHA256 := stringValue(payload["raw_sha256"])
	fingerprint := nullableString(payload["fingerprint_hex"])
	startedAt := nullableString(payload["started_at"])
	durationMS := nullableInt64(payload["duration_ms"])
	durationSeconds := nullableInt64(payload["duration_seconds"])
	if durationSeconds == nil && durationMS != nil {
		value := *durationMS / 1000
		durationSeconds = &value
	}
	maxDepth := nullableFloat64(payload["max_depth_m"])
	avgDepth := nullableFloat64(payload["avg_depth_m"])
	importedAt := stringValue(payload["imported_at"])
	if importedAt == "" {
		importedAt = nowISO()
	}
	tag, err := db.pool.Exec(ctx, `
        INSERT INTO dives(user_id, vendor, product, fingerprint_hex, dive_uid, started_at, duration_seconds, duration_ms, max_depth_m, avg_depth_m, import_payload_json, fields_json, raw_sha256, raw_data, samples_json, imported_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (user_id, dive_uid) DO NOTHING
    `, cleanText(userID), vendor, product, fingerprint, diveUID, startedAt, durationSeconds, durationMS, maxDepth, avgDepth, importJSON, fieldsJSON, rawSHA256, rawData, samplesJSON, importedAt)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (db *DB) GetDiveIDByUID(ctx context.Context, userID string, diveUID string) (*int64, error) {
	var id int64
	err := db.pool.QueryRow(ctx, "SELECT id FROM dives WHERE user_id=$1 AND dive_uid=$2", cleanText(userID), cleanText(diveUID)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &id, err
}

func (db *DB) ListDives(ctx context.Context, userID string, includeSamples bool, includeRawData bool, limit int, offset int) ([]Dive, int, error) {
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	var total int
	if err := db.pool.QueryRow(ctx, "SELECT COUNT(*) FROM dives WHERE user_id=$1", cleanText(userID)).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := db.pool.Query(ctx, `
        SELECT id, user_id, vendor, product, fingerprint_hex, dive_uid, started_at, duration_seconds, duration_ms,
               max_depth_m, avg_depth_m, import_payload_json, fields_json, raw_sha256,
               CASE WHEN $4 THEN raw_data ELSE ''::bytea END,
               CASE WHEN $5 THEN samples_json ELSE '[]'::jsonb END,
               COALESCE(jsonb_array_length(samples_json), 0),
               imported_at
        FROM dives WHERE user_id=$1 ORDER BY started_at DESC NULLS LAST, id DESC LIMIT $2 OFFSET $3
    `, cleanText(userID), limit, offset, includeRawData, includeSamples)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	dives, err := scanDives(rows, includeSamples, includeRawData)
	return dives, total, err
}

func (db *DB) ListAllDives(ctx context.Context, userID string, includeSamples bool, includeRawData bool) ([]Dive, error) {
	rows, err := db.pool.Query(ctx, `
        SELECT id, user_id, vendor, product, fingerprint_hex, dive_uid, started_at, duration_seconds, duration_ms,
               max_depth_m, avg_depth_m, import_payload_json, fields_json, raw_sha256,
               CASE WHEN $2 THEN raw_data ELSE ''::bytea END,
               CASE WHEN $3 THEN samples_json ELSE '[]'::jsonb END,
               COALESCE(jsonb_array_length(samples_json), 0),
               imported_at
        FROM dives WHERE user_id=$1 ORDER BY started_at DESC NULLS LAST, id DESC
    `, cleanText(userID), includeRawData, includeSamples)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDives(rows, includeSamples, includeRawData)
}

func (db *DB) GetDiverStats(ctx context.Context, userID string) (*DiverStats, error) {
	if db == nil || db.pool == nil {
		return &DiverStats{}, nil
	}
	query := `
WITH user_dives AS (
    SELECT
        id,
        duration_seconds,
        duration_ms,
        max_depth_m,
        fields_json,
        import_payload_json,
        (COALESCE(fields_json->'logbook'->>'status', import_payload_json->'fields'->'logbook'->>'status', '') = 'complete') AS is_complete
    FROM dives
    WHERE user_id = $1
),
counts AS (
    SELECT
        COUNT(*) AS total_count,
        COUNT(*) FILTER (WHERE is_complete) AS complete_count,
        COUNT(*) FILTER (WHERE NOT is_complete) AS imported_count
    FROM user_dives
),
target_dives AS (
    SELECT d.*
    FROM user_dives d, counts c
    WHERE (c.complete_count > 0 AND d.is_complete)
       OR (c.complete_count = 0)
)
SELECT
    c.imported_count,
    COUNT(t.id) AS target_count,
    COALESCE(SUM(
        CASE
            WHEN t.duration_seconds IS NOT NULL AND t.duration_seconds > 0 THEN t.duration_seconds
            WHEN t.duration_ms IS NOT NULL AND t.duration_ms > 0 THEN t.duration_ms / 1000
            ELSE 0
        END
    ), 0)::bigint AS total_seconds,
    COALESCE(MAX(t.max_depth_m), 0.0)::double precision AS max_depth,
    COALESCE(SUM(t.max_depth_m), 0.0)::double precision AS sum_depth,
    COALESCE(SUM(
        CASE
            WHEN (
                TRIM(COALESCE(
                    NULLIF(t.fields_json->'tanks'->0->>'beginpressure_bar', ''),
                    NULLIF(t.fields_json->'tanks'->0->>'begin_pressure_bar', ''),
                    NULLIF(t.import_payload_json->'fields'->'tanks'->0->>'beginpressure_bar', ''),
                    NULLIF(t.import_payload_json->'fields'->'tanks'->0->>'begin_pressure_bar', '')
                )) ~ '^[0-9]+(\.[0-9]+)?$'
                AND
                TRIM(COALESCE(
                    NULLIF(t.fields_json->'tanks'->0->>'endpressure_bar', ''),
                    NULLIF(t.fields_json->'tanks'->0->>'end_pressure_bar', ''),
                    NULLIF(t.import_payload_json->'fields'->'tanks'->0->>'endpressure_bar', ''),
                    NULLIF(t.import_payload_json->'fields'->'tanks'->0->>'end_pressure_bar', '')
                )) ~ '^[0-9]+(\.[0-9]+)?$'
            THEN GREATEST(0.0::numeric, ROUND(
                (TRIM(COALESCE(
                    NULLIF(t.fields_json->'tanks'->0->>'beginpressure_bar', ''),
                    NULLIF(t.fields_json->'tanks'->0->>'begin_pressure_bar', ''),
                    NULLIF(t.import_payload_json->'fields'->'tanks'->0->>'beginpressure_bar', ''),
                    NULLIF(t.import_payload_json->'fields'->'tanks'->0->>'begin_pressure_bar', '')
                )))::numeric
                -
                (TRIM(COALESCE(
                    NULLIF(t.fields_json->'tanks'->0->>'endpressure_bar', ''),
                    NULLIF(t.fields_json->'tanks'->0->>'end_pressure_bar', ''),
                    NULLIF(t.import_payload_json->'fields'->'tanks'->0->>'endpressure_bar', ''),
                    NULLIF(t.import_payload_json->'fields'->'tanks'->0->>'end_pressure_bar', '')
                )))::numeric
            ))
            ELSE 0.0::numeric
        END
    ), 0.0)::double precision AS total_bar_consumed
FROM counts c
LEFT JOIN target_dives t ON true
GROUP BY c.imported_count
`
	var importedCount int
	var targetCount int
	var totalSeconds int64
	var maxDepth float64
	var sumDepth float64
	var totalBarConsumed float64

	err := db.pool.QueryRow(ctx, query, cleanText(userID)).Scan(
		&importedCount,
		&targetCount,
		&totalSeconds,
		&maxDepth,
		&sumDepth,
		&totalBarConsumed,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &DiverStats{}, nil
		}
		return nil, err
	}

	var averageDurationSeconds float64
	var averageMaxDepth float64
	if targetCount > 0 {
		averageDurationSeconds = math.Round((float64(totalSeconds)/float64(targetCount))*100) / 100
		averageMaxDepth = math.Round((sumDepth/float64(targetCount))*100) / 100
	}

	var totalHours float64
	if totalSeconds > 0 {
		totalHours = math.Round((float64(totalSeconds)/3600.0)*10) / 10
	}

	bottomTimeProgress := int(math.Min(100, math.Round(totalHours)))

	return &DiverStats{
		TotalDives:             targetCount,
		TotalSeconds:           totalSeconds,
		TotalHours:             totalHours,
		MaxDepth:               maxDepth,
		TotalBarConsumed:       int(totalBarConsumed),
		AverageDurationSeconds: averageDurationSeconds,
		AverageMaxDepth:        averageMaxDepth,
		BottomTimeProgress:     bottomTimeProgress,
		ImportedCount:          importedCount,
	}, nil
}

func (db *DB) GetDive(ctx context.Context, userID string, diveID int64, includeRawData bool) (*Dive, error) {
	rows, err := db.pool.Query(ctx, `
        SELECT id, user_id, vendor, product, fingerprint_hex, dive_uid, started_at, duration_seconds, duration_ms,
               max_depth_m, avg_depth_m, import_payload_json, fields_json, raw_sha256,
               CASE WHEN $3 THEN raw_data ELSE ''::bytea END,
               samples_json,
               COALESCE(jsonb_array_length(samples_json), 0),
               imported_at
        FROM dives WHERE user_id=$1 AND id=$2
    `, cleanText(userID), diveID, includeRawData)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	dives, err := scanDives(rows, true, includeRawData)
	if err != nil || len(dives) == 0 {
		return nil, err
	}
	return &dives[0], nil
}

func (db *DB) UpdateDiveLogbook(ctx context.Context, userID string, diveID int64, payload map[string]any) (*Dive, error) {
	existing, err := db.GetDive(ctx, userID, diveID, false)
	if err != nil || existing == nil {
		return existing, err
	}
	fields := existing.Fields
	if fields == nil {
		fields = map[string]any{}
	}
	logbook := mapValue(payload["logbook"])
	if len(logbook) == 0 {
		logbook = cloneMap(payload)
	}
	logbook["updated_at"] = nowISO()
	if _, ok := logbook["status"]; !ok {
		logbook["status"] = "complete"
	}
	fields["logbook"] = logbook
	updateTanksFromPayload(fields, payload)
	fieldsJSON, _ := json.Marshal(fields)
	_, err = db.pool.Exec(ctx, "UPDATE dives SET fields_json=$1 WHERE user_id=$2 AND id=$3", fieldsJSON, cleanText(userID), diveID)
	if err != nil {
		return nil, err
	}
	return db.GetDive(ctx, userID, diveID, false)
}

func parseOptionalNumber(val any) *float64 {
	if val == nil {
		return nil
	}
	switch v := val.(type) {
	case float64:
		return &v
	case float32:
		f := float64(v)
		return &f
	case int:
		f := float64(v)
		return &f
	case int64:
		f := float64(v)
		return &f
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return nil
		}
		var f float64
		if _, err := fmt.Sscanf(trimmed, "%f", &f); err == nil {
			return &f
		}
	}
	return nil
}

func updateTanksFromPayload(fields map[string]any, payload map[string]any) {
	rawVol, hasVol := payload["tank_volume_l"]
	rawBegin, hasBegin := payload["begin_pressure_bar"]
	rawEnd, hasEnd := payload["end_pressure_bar"]

	if !hasVol && !hasBegin && !hasEnd {
		return
	}

	var tank0 map[string]any
	var otherTanks []any

	if rawTanks, ok := fields["tanks"].([]any); ok && len(rawTanks) > 0 {
		if t0, ok := rawTanks[0].(map[string]any); ok {
			tank0 = cloneMap(t0)
		}
		otherTanks = rawTanks[1:]
	} else if rawTanks, ok := fields["tanks"].([]map[string]any); ok && len(rawTanks) > 0 {
		tank0 = cloneMap(rawTanks[0])
		for _, t := range rawTanks[1:] {
			otherTanks = append(otherTanks, t)
		}
	}

	if tank0 == nil {
		tank0 = map[string]any{}
	}

	if hasVol {
		if vol := parseOptionalNumber(rawVol); vol != nil {
			tank0["volume"] = *vol
		} else {
			delete(tank0, "volume")
		}
	}

	if hasBegin {
		if begin := parseOptionalNumber(rawBegin); begin != nil {
			tank0["beginpressure_bar"] = *begin
			tank0["begin_pressure_bar"] = *begin
		} else {
			delete(tank0, "beginpressure_bar")
			delete(tank0, "begin_pressure_bar")
		}
	}

	if hasEnd {
		if end := parseOptionalNumber(rawEnd); end != nil {
			tank0["endpressure_bar"] = *end
			tank0["end_pressure_bar"] = *end
		} else {
			delete(tank0, "endpressure_bar")
			delete(tank0, "end_pressure_bar")
		}
	}

	if len(tank0) > 0 || len(otherTanks) > 0 {
		fields["tanks"] = append([]any{tank0}, otherTanks...)
	}
}

func (db *DB) DeleteDive(ctx context.Context, userID string, diveID int64) (bool, error) {
	tag, err := db.pool.Exec(ctx, "DELETE FROM dives WHERE user_id=$1 AND id=$2", cleanText(userID), diveID)
	return tag.RowsAffected() > 0, err
}

func scanDives(rows pgx.Rows, includeSamples bool, includeRawData bool) ([]Dive, error) {
	dives := []Dive{}
	for rows.Next() {
		var dive Dive
		var importJSON, fieldsJSON, samplesJSON []byte
		var rawData []byte
		var sampleCount int
		if err := rows.Scan(&dive.ID, &dive.UserID, &dive.Vendor, &dive.Product, &dive.FingerprintHex, &dive.DiveUID, &dive.StartedAt, &dive.DurationSeconds, &dive.DurationMS, &dive.MaxDepthM, &dive.AvgDepthM, &importJSON, &fieldsJSON, &dive.RawSHA256, &rawData, &samplesJSON, &sampleCount, &dive.ImportedAt); err != nil {
			return nil, err
		}
		dive.ImportPayload = decodeMap(importJSON)
		dive.Fields = decodeMap(fieldsJSON)
		dive.SampleCount = sampleCount
		if includeSamples {
			dive.Samples = decodeSlice(samplesJSON)
		}
		if includeRawData && len(rawData) > 0 {
			dive.RawDataB64 = base64.StdEncoding.EncodeToString(rawData)
		}
		if dive.DurationSeconds == nil && dive.DurationMS != nil {
			value := *dive.DurationMS / 1000
			dive.DurationSeconds = &value
		}
		dives = append(dives, dive)
	}
	return dives, rows.Err()
}

func (db *DB) GetUserProfile(ctx context.Context, userID string) (map[string]any, error) {
	profile := map[string]any{
		"user_id":                     cleanText(userID),
		"name":                        "",
		"email":                       "",
		"public_dives_enabled":        false,
		"public_slug":                 "",
		"logbook_display_fields":      []any{},
		"required_logbook_fields":     []any{"site"},
		"equipment_selection_enabled": true,
		"licenses":                    []any{},
		"dive_sites":                  []any{},
		"buddies":                     []any{},
		"guides":                      []any{},
	}
	var name, email, publicSlug string
	var publicEnabled, equipmentSelection bool
	var logbookDisplayJSON, requiredJSON []byte
	err := db.pool.QueryRow(ctx, `
        SELECT name, email, public_dives_enabled, public_slug, logbook_display_fields_json, required_logbook_fields_json, equipment_selection_enabled
        FROM user_profile WHERE user_id=$1
    `, cleanText(userID)).Scan(&name, &email, &publicEnabled, &publicSlug, &logbookDisplayJSON, &requiredJSON, &equipmentSelection)
	if errors.Is(err, pgx.ErrNoRows) {
		return profile, nil
	}
	if err != nil {
		return nil, err
	}
	profile["name"] = name
	profile["email"] = email
	profile["public_dives_enabled"] = publicEnabled
	profile["public_slug"] = publicSlug
	profile["equipment_selection_enabled"] = equipmentSelection
	profile["logbook_display_fields"] = decodeSlice(logbookDisplayJSON)
	profile["required_logbook_fields"] = decodeSlice(requiredJSON)
	profile["licenses"], _ = db.listCollection(ctx, "user_profile_licenses", "license_id", userID)
	profile["dive_sites"], _ = db.listCollection(ctx, "user_profile_dive_sites", "site_id", userID)
	profile["buddies"], _ = db.listCollection(ctx, "user_profile_buddies", "buddy_id", userID)
	profile["guides"], _ = db.listCollection(ctx, "user_profile_guides", "guide_id", userID)
	return profile, nil
}

func (db *DB) SaveUserProfile(ctx context.Context, userID string, payload map[string]any) (map[string]any, error) {
	existing, _ := db.GetUserProfile(ctx, userID)
	name := stringOrExisting(payload["name"], existing["name"])
	email := stringOrExisting(payload["email"], existing["email"])
	publicSlug := stringOrExisting(payload["public_slug"], existing["public_slug"])
	publicEnabled := boolOrExisting(payload["public_dives_enabled"], existing["public_dives_enabled"])
	equipmentSelection := boolOrExisting(payload["equipment_selection_enabled"], existing["equipment_selection_enabled"])
	displayJSON, _ := json.Marshal(valueOr(payload["logbook_display_fields"], existing["logbook_display_fields"]))
	requiredJSON, _ := json.Marshal(valueOr(payload["required_logbook_fields"], existing["required_logbook_fields"]))
	tx, err := db.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
        INSERT INTO user_profile(user_id, name, email, public_dives_enabled, public_slug, logbook_display_fields_json, required_logbook_fields_json, equipment_selection_enabled, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id) DO UPDATE SET
            name=excluded.name, email=excluded.email, public_dives_enabled=excluded.public_dives_enabled,
            public_slug=excluded.public_slug, logbook_display_fields_json=excluded.logbook_display_fields_json,
            required_logbook_fields_json=excluded.required_logbook_fields_json,
            equipment_selection_enabled=excluded.equipment_selection_enabled, updated_at=excluded.updated_at
    `, cleanText(userID), name, email, publicEnabled, publicSlug, displayJSON, requiredJSON, equipmentSelection, nowISO())
	if err != nil {
		return nil, err
	}
	if value, ok := payload["licenses"]; ok {
		if err := replaceProfileCollection(ctx, tx, "user_profile_licenses", "license_id", userID, sliceValue(value), []string{"company", "certification_name", "student_number", "certification_date", "instructor_number"}); err != nil {
			return nil, err
		}
	}
	if value, ok := payload["dive_sites"]; ok {
		if err := replaceProfileCollection(ctx, tx, "user_profile_dive_sites", "site_id", userID, sliceValue(value), []string{"name", "location", "country", "latitude", "longitude"}); err != nil {
			return nil, err
		}
	}
	if value, ok := payload["buddies"]; ok {
		if err := replaceProfileCollection(ctx, tx, "user_profile_buddies", "buddy_id", userID, sliceValue(value), []string{"name"}); err != nil {
			return nil, err
		}
	}
	if value, ok := payload["guides"]; ok {
		if err := replaceProfileCollection(ctx, tx, "user_profile_guides", "guide_id", userID, sliceValue(value), []string{"name"}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return db.GetUserProfile(ctx, userID)
}

func (db *DB) GetProfileLicensePDF(ctx context.Context, userID string, licenseID string) (string, string, []byte, error) {
	var filename, contentType string
	var data []byte
	err := db.pool.QueryRow(ctx, `
        SELECT filename, content_type, pdf_data FROM user_profile_license_documents
        WHERE user_id=$1 AND license_id=$2
    `, cleanText(userID), cleanText(licenseID)).Scan(&filename, &contentType, &data)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil, nil
	}
	return filename, contentType, data, err
}

func (db *DB) SaveProfileLicensePDF(ctx context.Context, userID string, licenseID string, filename string, contentType string, data []byte) (map[string]any, error) {
	var exists int
	err := db.pool.QueryRow(ctx, "SELECT 1 FROM user_profile_licenses WHERE user_id=$1 AND license_id=$2", cleanText(userID), cleanText(licenseID)).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_, err = db.pool.Exec(ctx, `
        INSERT INTO user_profile_license_documents(user_id, license_id, filename, content_type, pdf_data, uploaded_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, license_id)
        DO UPDATE SET filename=excluded.filename, content_type=excluded.content_type, pdf_data=excluded.pdf_data, uploaded_at=excluded.uploaded_at
    `, cleanText(userID), cleanText(licenseID), cleanText(filename), cleanText(contentType), data, nowISO())
	if err != nil {
		return nil, err
	}
	return db.GetUserProfile(ctx, userID)
}

func (db *DB) PublicProfile(ctx context.Context, slug string) (map[string]any, []Dive, error) {
	var userID string
	err := db.pool.QueryRow(ctx, `
        SELECT user_id FROM user_profile WHERE public_dives_enabled=TRUE AND public_slug=$1
    `, cleanText(slug)).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	profile, err := db.GetUserProfile(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	delete(profile, "email")
	delete(profile, "licenses")
	dives, err := db.ListAllDives(ctx, userID, false, false)
	if err != nil {
		return nil, nil, err
	}
	return profile, dives, nil
}

func replaceProfileCollection(ctx context.Context, tx pgx.Tx, table string, idColumn string, userID string, entries []any, columns []string) error {
	oldNames := map[string]string{}
	if table == "user_profile_dive_sites" || table == "user_profile_buddies" || table == "user_profile_guides" {
		rows, err := tx.Query(ctx, fmt.Sprintf("SELECT %s, name FROM %s WHERE user_id=$1", idColumn, table), cleanText(userID))
		if err == nil {
			for rows.Next() {
				var id, name string
				if err := rows.Scan(&id, &name); err == nil {
					oldNames[id] = name
				}
			}
			rows.Close()
		}
	}

	renames := map[string]string{}
	seenIDs := make([]string, 0, len(entries))
	for index, entry := range entries {
		item := mapValue(entry)
		id := stringValue(valueOr(item["id"], item[idColumn]))
		if id == "" {
			id = fmt.Sprintf("%s_%d_%d", idColumn, time.Now().UnixNano(), index)
		}
		seenIDs = append(seenIDs, id)

		newName := stringValue(item["name"])
		if oldName, ok := oldNames[id]; ok && oldName != "" && newName != "" && oldName != newName {
			renames[oldName] = newName
		}

		names := []string{"user_id", idColumn}
		args := []any{cleanText(userID), id}
		placeholders := []string{"$1", "$2"}
		updateClauses := make([]string, 0, len(columns))
		for _, column := range columns {
			names = append(names, column)
			placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)+1))
			updateClauses = append(updateClauses, fmt.Sprintf("%s = EXCLUDED.%s", column, column))
			switch column {
			case "latitude", "longitude":
				args = append(args, nullableFloat64(item[column]))
			default:
				args = append(args, stringValue(item[column]))
			}
		}
		upsertSQL := fmt.Sprintf(
			"INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (user_id, %s) DO UPDATE SET %s",
			table,
			stringsJoin(names, ", "),
			stringsJoin(placeholders, ", "),
			idColumn,
			stringsJoin(updateClauses, ", "),
		)
		if _, err := tx.Exec(ctx, upsertSQL, args...); err != nil {
			return err
		}
	}
	if len(seenIDs) == 0 {
		_, err := tx.Exec(ctx, "DELETE FROM "+table+" WHERE user_id=$1", cleanText(userID))
		return err
	}
	if _, err := tx.Exec(ctx, "DELETE FROM "+table+" WHERE user_id=$1 AND NOT ("+idColumn+" = ANY($2))", cleanText(userID), seenIDs); err != nil {
		return err
	}

	for oldName, newName := range renames {
		switch table {
		case "user_profile_dive_sites":
			if err := cascadeSiteRename(ctx, tx, userID, oldName, newName); err != nil {
				return err
			}
		case "user_profile_buddies":
			if err := cascadeBuddyRename(ctx, tx, userID, oldName, newName); err != nil {
				return err
			}
		case "user_profile_guides":
			if err := cascadeGuideRename(ctx, tx, userID, oldName, newName); err != nil {
				return err
			}
		}
	}

	return nil
}

func cascadeSiteRename(ctx context.Context, tx pgx.Tx, userID string, oldName string, newName string) error {
	_, err := tx.Exec(ctx, `
		UPDATE dives
		SET fields_json = (
			CASE
				WHEN fields_json ? 'site' AND fields_json->>'site' = $3 THEN
					jsonb_set(
						jsonb_set(
							CASE WHEN NOT (fields_json ? 'logbook') THEN jsonb_set(fields_json, '{logbook}', '{}'::jsonb, true) ELSE fields_json END,
							'{logbook,site}',
							to_jsonb($1::text),
							true
						),
						'{site}',
						to_jsonb($1::text),
						false
					)
				ELSE
					jsonb_set(
						CASE WHEN NOT (fields_json ? 'logbook') THEN jsonb_set(fields_json, '{logbook}', '{}'::jsonb, true) ELSE fields_json END,
						'{logbook,site}',
						to_jsonb($1::text),
						true
					)
			END
		)
		WHERE user_id = $2
		  AND (fields_json->'logbook'->>'site' = $3 OR fields_json->>'site' = $3)
	`, cleanText(newName), cleanText(userID), cleanText(oldName))
	return err
}

func cascadeBuddyRename(ctx context.Context, tx pgx.Tx, userID string, oldName string, newName string) error {
	rows, err := tx.Query(ctx, `
		SELECT id, fields_json
		FROM dives
		WHERE user_id = $1
		  AND (fields_json->'logbook'->>'buddy' LIKE '%' || $2 || '%' OR fields_json->>'buddy' LIKE '%' || $2 || '%')
	`, cleanText(userID), cleanText(oldName))
	if err != nil {
		return err
	}
	defer rows.Close()

	type updateEntry struct {
		id         int64
		fieldsJSON []byte
	}
	var updates []updateEntry

	for rows.Next() {
		var id int64
		var fieldsJSON []byte
		if err := rows.Scan(&id, &fieldsJSON); err != nil {
			return err
		}
		var fields map[string]any
		if err := json.Unmarshal(fieldsJSON, &fields); err != nil {
			continue
		}
		modified := false
		if logbook, ok := fields["logbook"].(map[string]any); ok && logbook != nil {
			if buddyStr, ok := logbook["buddy"].(string); ok {
				if newBuddyStr, changed := replaceTokenInList(buddyStr, oldName, newName); changed {
					logbook["buddy"] = newBuddyStr
					fields["logbook"] = logbook
					modified = true
				}
			}
		}
		if buddyStr, ok := fields["buddy"].(string); ok {
			if newBuddyStr, changed := replaceTokenInList(buddyStr, oldName, newName); changed {
				fields["buddy"] = newBuddyStr
				modified = true
			}
		}
		if modified {
			updatedBytes, _ := json.Marshal(fields)
			updates = append(updates, updateEntry{id: id, fieldsJSON: updatedBytes})
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, entry := range updates {
		if _, err := tx.Exec(ctx, "UPDATE dives SET fields_json=$1 WHERE id=$2", entry.fieldsJSON, entry.id); err != nil {
			return err
		}
	}
	return nil
}

func cascadeGuideRename(ctx context.Context, tx pgx.Tx, userID string, oldName string, newName string) error {
	rows, err := tx.Query(ctx, `
		SELECT id, fields_json
		FROM dives
		WHERE user_id = $1
		  AND (fields_json->'logbook'->>'guide' LIKE '%' || $2 || '%' OR fields_json->>'guide' LIKE '%' || $2 || '%')
	`, cleanText(userID), cleanText(oldName))
	if err != nil {
		return err
	}
	defer rows.Close()

	type updateEntry struct {
		id         int64
		fieldsJSON []byte
	}
	var updates []updateEntry

	for rows.Next() {
		var id int64
		var fieldsJSON []byte
		if err := rows.Scan(&id, &fieldsJSON); err != nil {
			return err
		}
		var fields map[string]any
		if err := json.Unmarshal(fieldsJSON, &fields); err != nil {
			continue
		}
		modified := false
		if logbook, ok := fields["logbook"].(map[string]any); ok && logbook != nil {
			if guideStr, ok := logbook["guide"].(string); ok {
				if newGuideStr, changed := replaceTokenInList(guideStr, oldName, newName); changed {
					logbook["guide"] = newGuideStr
					fields["logbook"] = logbook
					modified = true
				}
			}
		}
		if guideStr, ok := fields["guide"].(string); ok {
			if newGuideStr, changed := replaceTokenInList(guideStr, oldName, newName); changed {
				fields["guide"] = newGuideStr
				modified = true
			}
		}
		if modified {
			updatedBytes, _ := json.Marshal(fields)
			updates = append(updates, updateEntry{id: id, fieldsJSON: updatedBytes})
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, entry := range updates {
		if _, err := tx.Exec(ctx, "UPDATE dives SET fields_json=$1 WHERE id=$2", entry.fieldsJSON, entry.id); err != nil {
			return err
		}
	}
	return nil
}

func replaceTokenInList(str string, oldName string, newName string) (string, bool) {
	trimmedOld := strings.TrimSpace(oldName)
	if strings.TrimSpace(str) == "" || trimmedOld == "" {
		return str, false
	}
	if strings.TrimSpace(str) == trimmedOld {
		return newName, true
	}
	parts := strings.Split(str, ",")
	changed := false
	for i, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == trimmedOld {
			startIdx := strings.Index(part, trimmed)
			prefix := part[:startIdx]
			suffix := part[startIdx+len(trimmed):]
			parts[i] = prefix + newName + suffix
			changed = true
		}
	}
	if changed {
		return strings.Join(parts, ","), true
	}
	return str, false
}

func (db *DB) listCollection(ctx context.Context, table string, idColumn string, userID string) ([]any, error) {
	rows, err := db.pool.Query(ctx, "SELECT row_to_json(t) FROM (SELECT * FROM "+table+" WHERE user_id=$1 ORDER BY "+idColumn+") t", cleanText(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []any{}
	for rows.Next() {
		var body []byte
		if err := rows.Scan(&body); err != nil {
			return nil, err
		}
		item := decodeMap(body)
		item["id"] = item[idColumn]
		items = append(items, item)
	}
	return items, rows.Err()
}

func (db *DB) ListDeviceStates(ctx context.Context, userID string) ([]DeviceState, error) {
	rows, err := db.pool.Query(ctx, `
        SELECT user_id, vendor, product, fingerprint_hex, updated_at
        FROM device_state WHERE user_id=$1 ORDER BY vendor, product
    `, cleanText(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	states := []DeviceState{}
	for rows.Next() {
		var state DeviceState
		if err := rows.Scan(&state.UserID, &state.Vendor, &state.Product, &state.FingerprintHex, &state.UpdatedAt); err != nil {
			return nil, err
		}
		states = append(states, state)
	}
	return states, rows.Err()
}

func (db *DB) countCommittedDives(ctx context.Context, userID string) (int, error) {
	var count int
	err := db.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM dives
		WHERE user_id=$1 AND fields_json->'logbook'->>'status' = 'complete'
	`, cleanText(userID)).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

func parseISODate(value any) *time.Time {
	str := cleanText(stringValue(value))
	if str == "" {
		return nil
	}
	if len(str) >= 10 {
		datePart := str[:10]
		if t, err := time.Parse("2006-01-02", datePart); err == nil {
			utc := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
			return &utc
		}
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02",
	} {
		if t, err := time.Parse(layout, str); err == nil {
			utc := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
			return &utc
		}
	}
	return nil
}

func addMonths(sourceDate time.Time, months int) time.Time {
	totalMonths := int(sourceDate.Month()) - 1 + months
	year := sourceDate.Year() + totalMonths/12
	monthIndex := totalMonths % 12
	if monthIndex < 0 {
		monthIndex += 12
		year--
	}
	month := time.Month(monthIndex + 1)
	maxDays := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
	day := sourceDate.Day()
	if day > maxDays {
		day = maxDays
	}
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func equipmentServiceStatusForDive(item map[string]any, diveStartedAt any) map[string]any {
	diveDate := parseISODate(diveStartedAt)
	lastServiceVal := item["last_service_date"]
	if stringValue(lastServiceVal) == "" {
		lastServiceVal = item["last_serviced_at"]
	}
	lastServiceDate := parseISODate(lastServiceVal)
	interval := intValue(item["service_interval_months"])

	if diveDate == nil {
		return map[string]any{
			"service_status":   "unknown",
			"service_due_date": "",
			"service_message":  "Dive date is unavailable.",
		}
	}
	if lastServiceDate == nil || interval <= 0 {
		return map[string]any{
			"service_status":   "unknown",
			"service_due_date": "",
			"service_message":  "Service date or interval is missing.",
		}
	}

	serviceDueDate := addMonths(*lastServiceDate, interval)
	serviceDueDateStr := serviceDueDate.Format("2006-01-02")

	if lastServiceDate.After(*diveDate) {
		return map[string]any{
			"service_status":   "unknown",
			"service_due_date": serviceDueDateStr,
			"service_message":  "Latest service date is after this dive.",
		}
	}
	if diveDate.After(serviceDueDate) {
		return map[string]any{
			"service_status":   "overdue",
			"service_due_date": serviceDueDateStr,
			"service_message":  "Service was overdue for this dive.",
		}
	}
	dueSoonThreshold := addMonths(*diveDate, 1)
	status := "serviced"
	if !serviceDueDate.After(dueSoonThreshold) {
		status = "due_soon"
	}
	return map[string]any{
		"service_status":   status,
		"service_due_date": serviceDueDateStr,
		"service_message":  "",
	}
}

func equipmentServiceSummary(item map[string]any, committedDiveCount int, serviceDueDate string) map[string]any {
	var maxDivesVal any
	var hasMaxDives bool
	if md := nullableInt64(item["max_dives_before_service"]); md != nil && *md > 0 {
		maxDivesVal = int(*md)
		hasMaxDives = true
	}

	baseline := intValue(item["last_service_dive_count"])
	isStandard := boolOrExisting(item["is_default"], boolOrExisting(item["is_standard"], false))
	divesSinceService := 0
	if isStandard {
		divesSinceService = committedDiveCount - baseline
		if divesSinceService < 0 {
			divesSinceService = 0
		}
	}

	var divesRemaining any
	diveDue := false
	if hasMaxDives {
		maxD := maxDivesVal.(int)
		rem := maxD - divesSinceService
		if rem < 0 {
			rem = 0
		}
		divesRemaining = rem
		diveDue = divesSinceService >= maxD
	}

	dateDue := false
	dueDateStr := cleanText(stringValue(item["next_service_due"]))
	if dueDateStr == "" {
		dueDateStr = serviceDueDate
	}
	if dueDateStr != "" {
		if dt := parseISODate(dueDateStr); dt != nil {
			today := time.Now().UTC()
			todayDate := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
			dateDue = !dt.After(todayDate)
		}
	}

	serviceDueReason := ""
	if diveDue {
		serviceDueReason = "dives"
	} else if dateDue {
		serviceDueReason = "date"
	}

	return map[string]any{
		"dives_since_service":            divesSinceService,
		"dives_remaining_before_service": divesRemaining,
		"service_due":                    diveDue || dateDue,
		"service_due_reason":             serviceDueReason,
	}
}

func (db *DB) ListEquipment(ctx context.Context, userID string) ([]map[string]any, error) {
	committedDives, err := db.countCommittedDives(ctx, userID)
	if err != nil {
		committedDives = 0
	}
	rows, err := db.pool.Query(ctx, "SELECT row_to_json(t) FROM (SELECT * FROM user_equipment WHERE user_id=$1 ORDER BY name, equipment_id) t", cleanText(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	now := time.Now().UTC().Format(time.RFC3339)
	for rows.Next() {
		var body []byte
		if err := rows.Scan(&body); err != nil {
			return nil, err
		}
		item := decodeMap(body)
		item["id"] = item["equipment_id"]
		serviceStatus := equipmentServiceStatusForDive(item, now)
		for k, v := range serviceStatus {
			item[k] = v
		}
		serviceDueDate := stringValue(serviceStatus["service_due_date"])
		if stringValue(item["next_service_due"]) == "" && serviceDueDate != "" {
			item["next_service_due"] = serviceDueDate
		}
		serviceSummary := equipmentServiceSummary(item, committedDives, serviceDueDate)
		for k, v := range serviceSummary {
			item[k] = v
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (db *DB) SaveEquipment(ctx context.Context, userID string, entries []any) ([]map[string]any, error) {
	tx, err := db.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	oldEquipmentNames := map[string]string{}
	eqRows, err := tx.Query(ctx, "SELECT equipment_id, name FROM user_equipment WHERE user_id=$1", cleanText(userID))
	if err == nil {
		for eqRows.Next() {
			var eqID, eqName string
			if err := eqRows.Scan(&eqID, &eqName); err == nil {
				oldEquipmentNames[eqID] = eqName
			}
		}
		eqRows.Close()
	}

	if _, err := tx.Exec(ctx, "DELETE FROM user_equipment WHERE user_id=$1", cleanText(userID)); err != nil {
		return nil, err
	}

	type eqRename struct {
		id      string
		oldName string
		newName string
	}
	var renames []eqRename

	for _, entry := range entries {
		item := mapValue(entry)
		id := stringValue(valueOr(item["id"], item["equipment_id"]))
		if id == "" {
			id = "equipment_" + time.Now().UTC().Format("20060102150405.000000000")
		}
		newName := stringValue(item["name"])
		if oldName, ok := oldEquipmentNames[id]; ok && oldName != "" && newName != "" && oldName != newName {
			renames = append(renames, eqRename{id: id, oldName: oldName, newName: newName})
		}
		nextServiceDue := stringValue(item["next_service_due"])
		lastServiceDate := stringValue(item["last_service_date"])
		intervalMonths := nullableInt64(item["service_interval_months"])
		if nextServiceDue == "" && lastServiceDate != "" && intervalMonths != nil && *intervalMonths > 0 {
			if lsd := parseISODate(lastServiceDate); lsd != nil {
				nextServiceDue = addMonths(*lsd, int(*intervalMonths)).Format("2006-01-02")
			}
		}
		_, err := tx.Exec(ctx, `
            INSERT INTO user_equipment(user_id, equipment_id, name, category, icon, type, year_bought, vendor, brand, model, serial, warranty, next_service_due, service_interval_months, last_service_date, max_dives_before_service, track_service, service_tag, is_default, is_standard, last_serviced_at, last_service_dive_count, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        `, cleanText(userID), id, stringValue(item["name"]), stringValue(item["category"]), stringValue(item["icon"]), stringValue(item["type"]), nullableInt64(item["year_bought"]), stringValue(item["vendor"]), stringValue(item["brand"]), stringValue(item["model"]), stringValue(item["serial"]), stringValue(item["warranty"]), nextServiceDue, intervalMonths, lastServiceDate, nullableInt64(item["max_dives_before_service"]), boolOrExisting(item["track_service"], true), stringValue(item["service_tag"]), boolOrExisting(item["is_default"], false), boolOrExisting(item["is_standard"], false), nullableString(item["last_serviced_at"]), intValue(item["last_service_dive_count"]), nowISO())
		if err != nil {
			return nil, err
		}
	}

	for _, r := range renames {
		if err := cascadeEquipmentRename(ctx, tx, userID, r.id, r.oldName, r.newName); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return db.ListEquipment(ctx, userID)
}

func cascadeEquipmentRename(ctx context.Context, tx pgx.Tx, userID string, equipmentID string, oldName string, newName string) error {
	rows, err := tx.Query(ctx, `
		SELECT id, fields_json
		FROM dives
		WHERE user_id = $1
		  AND (fields_json->'logbook'->'equipment_snapshot'::text LIKE '%' || $2 || '%')
	`, cleanText(userID), cleanText(equipmentID))
	if err != nil {
		return err
	}
	defer rows.Close()

	type updateEntry struct {
		id         int64
		fieldsJSON []byte
	}
	var updates []updateEntry

	for rows.Next() {
		var id int64
		var fieldsJSON []byte
		if err := rows.Scan(&id, &fieldsJSON); err != nil {
			return err
		}
		var fields map[string]any
		if err := json.Unmarshal(fieldsJSON, &fields); err != nil {
			continue
		}
		logbook, _ := fields["logbook"].(map[string]any)
		if logbook == nil {
			continue
		}
		snapshot, ok := logbook["equipment_snapshot"].([]any)
		if !ok || len(snapshot) == 0 {
			continue
		}
		modified := false
		for i, itemRaw := range snapshot {
			itemMap, ok := itemRaw.(map[string]any)
			if !ok {
				continue
			}
			itemID := stringValue(valueOr(itemMap["id"], itemMap["equipment_id"]))
			if itemID == equipmentID {
				itemMap["name"] = newName
				snapshot[i] = itemMap
				modified = true
			}
		}
		if modified {
			logbook["equipment_snapshot"] = snapshot
			fields["logbook"] = logbook
			updatedBytes, _ := json.Marshal(fields)
			updates = append(updates, updateEntry{id: id, fieldsJSON: updatedBytes})
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, entry := range updates {
		if _, err := tx.Exec(ctx, "UPDATE dives SET fields_json=$1 WHERE id=$2", entry.fieldsJSON, entry.id); err != nil {
			return err
		}
	}
	return nil
}

func (db *DB) MarkEquipmentServiced(ctx context.Context, userID string, equipmentID string) (map[string]any, error) {
	now := nowISO()
	servicedDate := now
	if len(now) >= 10 {
		servicedDate = now[:10]
	}
	diveCount, _ := db.countCommittedDives(ctx, userID)

	var intervalMonths *int64
	_ = db.pool.QueryRow(ctx, "SELECT service_interval_months FROM user_equipment WHERE user_id=$1 AND equipment_id=$2", cleanText(userID), cleanText(equipmentID)).Scan(&intervalMonths)

	nextServiceDue := ""
	if intervalMonths != nil && *intervalMonths > 0 {
		if sd := parseISODate(servicedDate); sd != nil {
			nextServiceDue = addMonths(*sd, int(*intervalMonths)).Format("2006-01-02")
		}
	}

	tag, err := db.pool.Exec(ctx, `
        UPDATE user_equipment
        SET last_serviced_at=$1, last_service_date=$2, last_service_dive_count=$3, next_service_due=CASE WHEN $4 <> '' THEN $4 ELSE next_service_due END, updated_at=$1
        WHERE user_id=$5 AND equipment_id=$6
    `, now, servicedDate, diveCount, nextServiceDue, cleanText(userID), cleanText(equipmentID))
	if err != nil || tag.RowsAffected() == 0 {
		return nil, err
	}
	items, err := db.ListEquipment(ctx, userID)
	for _, item := range items {
		if stringValue(item["equipment_id"]) == equipmentID {
			return item, err
		}
	}
	return nil, err
}

func decodeMap(body []byte) map[string]any {
	value := map[string]any{}
	_ = json.Unmarshal(body, &value)
	return value
}

func decodeSlice(body []byte) []any {
	value := []any{}
	_ = json.Unmarshal(body, &value)
	return value
}

func mapValue(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok {
		return cloneMap(typed)
	}
	return map[string]any{}
}

func sliceValue(value any) []any {
	if typed, ok := value.([]any); ok {
		return typed
	}
	return []any{}
}

func cloneMap(value map[string]any) map[string]any {
	next := map[string]any{}
	for key, item := range value {
		next[key] = item
	}
	return next
}

func stringValue(value any) string {
	if typed, ok := value.(string); ok {
		return cleanText(typed)
	}
	return ""
}

func nullableString(value any) *string {
	text := stringValue(value)
	if text == "" {
		return nil
	}
	return &text
}

func nullableInt64(value any) *int64 {
	switch typed := value.(type) {
	case int64:
		return &typed
	case int:
		next := int64(typed)
		return &next
	case float64:
		next := int64(typed)
		return &next
	default:
		return nil
	}
}

func nullableFloat64(value any) *float64 {
	switch typed := value.(type) {
	case float64:
		return &typed
	case int:
		next := float64(typed)
		return &next
	case int64:
		next := float64(typed)
		return &next
	default:
		return nil
	}
}

func boolOrExisting(value any, fallback any) bool {
	if typed, ok := value.(bool); ok {
		return typed
	}
	if typed, ok := fallback.(bool); ok {
		return typed
	}
	return false
}

func stringOrExisting(value any, fallback any) string {
	if text := stringValue(value); text != "" {
		return text
	}
	return stringValue(fallback)
}

func valueOr(value any, fallback any) any {
	if value == nil {
		return fallback
	}
	return value
}

func intValue(value any) int {
	if parsed := nullableInt64(value); parsed != nil {
		return int(*parsed)
	}
	return 0
}

func stringsJoin(values []string, sep string) string {
	out := ""
	for index, value := range values {
		if index > 0 {
			out += sep
		}
		out += value
	}
	return out
}
