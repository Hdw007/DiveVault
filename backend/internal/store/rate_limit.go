package store

import (
	"context"
	"errors"
	"time"
)

// AllowRateLimit checks and increments a rate limit key atomically.
// It returns allowed (true/false), remaining requests in window, and error.
func (db *DB) AllowRateLimit(ctx context.Context, key string, limit int, windowSeconds int) (bool, int, error) {
	if db == nil || db.pool == nil {
		return false, 0, errors.New("database is not configured")
	}
	if limit <= 0 {
		limit = 1
	}
	if windowSeconds <= 0 {
		windowSeconds = 60
	}
	now := time.Now().Unix()
	var count int
	err := db.pool.QueryRow(ctx, `
		INSERT INTO rate_limits (key, count, reset_at)
		VALUES ($1, 1, $2 + $3)
		ON CONFLICT (key) DO UPDATE
		SET count = CASE
				WHEN rate_limits.reset_at <= $2 THEN 1
				ELSE LEAST(rate_limits.count + 1, $4 + 1)
			END,
			reset_at = CASE
				WHEN rate_limits.reset_at <= $2 THEN $2 + $3
				ELSE rate_limits.reset_at
			END
		RETURNING count
	`, cleanText(key), now, int64(windowSeconds), limit).Scan(&count)
	if err != nil {
		return false, 0, err
	}
	allowed := count <= limit
	remaining := limit - count
	if remaining < 0 {
		remaining = 0
	}
	return allowed, remaining, nil
}

// ResetRateLimit resets or deletes a rate limit key (e.g. after successful login).
func (db *DB) ResetRateLimit(ctx context.Context, key string) error {
	if db == nil || db.pool == nil {
		return nil
	}
	_, err := db.pool.Exec(ctx, "DELETE FROM rate_limits WHERE key=$1", cleanText(key))
	return err
}

