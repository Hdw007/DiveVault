package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jlemmings/divevault/backend/internal/auth"
	"github.com/jlemmings/divevault/backend/internal/config"
	"github.com/jlemmings/divevault/backend/internal/metrics"
	"github.com/jlemmings/divevault/backend/internal/static"
	"github.com/jlemmings/divevault/backend/internal/store"
)

type Server struct {
	cfg           config.Config
	logger        *slog.Logger
	db            *store.DB
	routes        []Route
	auth          auth.Verifier
	metrics       *metrics.Recorder
	limiter       *fixedWindowLimiter
	schemaVersion int
}

type Context struct {
	ResponseWriter http.ResponseWriter
	Request        *http.Request
	Server         *Server
	Route          Route
	Params         map[string]string
	Claims         auth.Claims
	PrincipalID    string
}

func NewServer(cfg config.Config, logger *slog.Logger, db *store.DB) *Server {
	authVerifier := auth.Verifier{
		Secret:   cfg.AuthJWTSecret,
		Issuer:   cfg.AuthJWTIssuer,
		Audience: cfg.AuthJWTAudience,
	}
	return &Server{
		cfg:     cfg,
		logger:  logger,
		db:      db,
		routes:  APIRoutes(),
		auth:    authVerifier,
		metrics: metrics.NewRecorder(),
		limiter: newFixedWindowLimiter(),
	}
}

func (s *Server) SetSchemaVersion(version int) {
	s.schemaVersion = version
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	if s.cfg.RequestTimeoutSeconds > 0 {
		requestCtx, cancel := context.WithTimeout(r.Context(), time.Duration(s.cfg.RequestTimeoutSeconds)*time.Second)
		defer cancel()
		r = r.WithContext(requestCtx)
	}
	recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	routeLabel := r.URL.Path
	defer func() {
		if s.metrics != nil {
			s.metrics.Observe(r.Method, routeLabel, recorder.status)
		}
		s.logger.Info("request_complete",
			"method", r.Method,
			"path", r.URL.Path,
			"route", routeLabel,
			"status", recorder.status,
			"duration_ms", time.Since(started).Milliseconds(),
		)
	}()

	if r.Method == http.MethodOptions {
		s.writePreflight(recorder)
		return
	}
	if r.URL.Path == "/metrics" && r.Method == http.MethodGet {
		routeLabel = "/metrics"
		s.handleMetrics(recorder)
		return
	}
	if r.URL.Path == "/metrics" {
		recorder.Header().Set("Allow", http.MethodGet)
		writeJSON(recorder, s.cfg.CORSOrigin, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

	if r.URL.Path == "/health" && r.Method == http.MethodGet {
		routeLabel = "/health"
		handleHealth(&Context{ResponseWriter: recorder, Request: r, Server: s})
		return
	}
	if r.URL.Path == "/health" {
		recorder.Header().Set("Allow", http.MethodGet)
		writeJSON(recorder, s.cfg.CORSOrigin, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	if r.URL.Path == "/config.js" && r.Method == http.MethodGet {
		routeLabel = "/config.js"
		handleConfig(&Context{ResponseWriter: recorder, Request: r, Server: s})
		return
	}
	if r.URL.Path == "/config.js" {
		recorder.Header().Set("Allow", http.MethodGet)
		writeJSON(recorder, s.cfg.CORSOrigin, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

	route, allowed, params := s.matchRoute(r.Method, r.URL.Path)
	if route != nil {
		routeLabel = route.Path
		claims, principalID, ok := s.applyRoutePolicy(recorder, r, *route)
		if !ok {
			return
		}
		route.handler(&Context{ResponseWriter: recorder, Request: r, Server: s, Route: *route, Params: params, Claims: claims, PrincipalID: principalID})
		return
	}
	if len(allowed) > 0 {
		recorder.Header().Set("Allow", strings.Join(allowed, ", "))
		writeJSON(recorder, s.cfg.CORSOrigin, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	if r.Method == http.MethodGet && !strings.HasPrefix(r.URL.Path, "/api/") {
		routeLabel = "frontend"
		s.serveFrontend(recorder, r)
		return
	}
	writeJSON(recorder, s.cfg.CORSOrigin, http.StatusNotFound, map[string]string{"error": "Not found"})
}

func (s *Server) matchRoute(method string, path string) (*Route, []string, map[string]string) {
	allowed := []string{}
	for i := range s.routes {
		route := &s.routes[i]
		params, matches := route.match(path)
		if !matches {
			continue
		}
		if route.Method == method {
			return route, nil, params
		}
		allowed = append(allowed, route.Method)
	}
	return nil, allowed, nil
}

func (s *Server) applyRoutePolicy(w http.ResponseWriter, r *http.Request, route Route) (auth.Claims, string, bool) {
	maxBody := s.maxBodyBytes(route.MaxBodyAttr)
	if maxBody > 0 {
		if r.ContentLength > maxBody {
			writeJSON(w, s.cfg.CORSOrigin, http.StatusRequestEntityTooLarge, map[string]string{"error": "Request body exceeds " + route.MaxBodyAttr + " byte limit"})
			return nil, "", false
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	}
	if len(route.ContentTypes) > 0 && r.ContentLength != 0 {
		contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || !contains(route.ContentTypes, contentType) {
			writeJSON(w, s.cfg.CORSOrigin, http.StatusUnsupportedMediaType, map[string]string{"error": contentTypeError(route.ContentTypes)})
			return nil, "", false
		}
	}
	if route.RateLimitScope != "" {
		limit := s.rateLimit(route.RateLimitScope)
		if limit > 0 {
			allowed, retryAfter := s.allowRateLimit(r.Context(), route.RateLimitScope+":"+s.clientIP(r), limit, s.cfg.RateLimitWindowSeconds)
			if !allowed {
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				writeJSON(w, s.cfg.CORSOrigin, http.StatusTooManyRequests, map[string]string{"error": "Rate limit exceeded. Please retry later."})
				return nil, "", false
			}
		}
	}
	if route.Auth == AuthNone {
		return nil, "", true
	}
	claims, err := s.auth.VerifyRequest(r.Context(), r)
	if err != nil {
		var authErr auth.Error
		if errors.As(err, &authErr) {
			writeJSON(w, s.cfg.CORSOrigin, authErr.Status, map[string]string{"error": authErr.Message})
			return nil, "", false
		}
		writeJSON(w, s.cfg.CORSOrigin, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return nil, "", false
	}
	if source, _ := claims["auth_source"].(string); source == "cookie" {
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete || r.Method == http.MethodPatch {
			if !s.isTrustedOrigin(r) {
				writeJSON(w, s.cfg.CORSOrigin, http.StatusForbidden, map[string]string{"error": "CSRF validation failed: untrusted origin"})
				return nil, "", false
			}
		}
	}
	principalID := auth.PrincipalID(claims)
	if principalID == "" {
		writeJSON(w, s.cfg.CORSOrigin, http.StatusForbidden, map[string]string{"error": "Authenticated identity is missing a stable user identifier"})
		return nil, "", false
	}
	if s.db != nil {
		user, err := s.db.GetAuthUserByID(r.Context(), principalID)
		if err != nil {
			writeJSON(w, s.cfg.CORSOrigin, http.StatusServiceUnavailable, map[string]string{"error": "Database unavailable: " + err.Error()})
			return nil, "", false
		}
		if user == nil {
			writeJSON(w, s.cfg.CORSOrigin, http.StatusUnauthorized, map[string]string{"error": "User account no longer exists"})
			return nil, "", false
		}
		if !user.IsActive {
			writeJSON(w, s.cfg.CORSOrigin, http.StatusForbidden, map[string]string{"error": "User account is disabled"})
			return nil, "", false
		}
		claims["role"] = user.Role
	}
	switch route.Auth {
	case AuthPrincipal:
	case AuthOwner:
		settings, err := s.authSettings(r.Context())
		if err != nil {
			writeJSON(w, s.cfg.CORSOrigin, http.StatusServiceUnavailable, map[string]string{"error": "Database unavailable: " + err.Error()})
			return nil, "", false
		}
		if principalID != settings.OwnerUserID {
			writeJSON(w, s.cfg.CORSOrigin, http.StatusForbidden, map[string]string{"error": "Instance owner required"})
			return nil, "", false
		}
	}
	return claims, principalID, true
}

func (s *Server) maxBodyBytes(attr string) int64 {
	switch attr {
	case "MaxJSONBodyBytes":
		return s.cfg.MaxJSONBodyBytes
	case "MaxBackupImportBytes":
		return s.cfg.MaxBackupImportBytes
	case "MaxCSVImportBytes":
		return s.cfg.MaxCSVImportBytes
	case "MaxSubsurfaceImportBytes":
		return s.cfg.MaxSubsurfaceImportBytes
	default:
		return 0
	}
}

func (s *Server) writePreflight(w http.ResponseWriter) {
	applyCORS(w.Header(), s.cfg.CORSOrigin)
	applySecurityHeaders(w.Header())
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) serveFrontend(w http.ResponseWriter, r *http.Request) {
	assetPath, ok := static.AssetPath(s.cfg.FrontendDir, r.URL.Path)
	if !ok {
		writeJSON(w, s.cfg.CORSOrigin, http.StatusNotFound, map[string]string{"error": "Frontend asset not found"})
		return
	}
	applySecurityHeaders(w.Header())
	http.ServeFile(w, r, assetPath)
}

func handleHealth(ctx *Context) {
	writeJSON(ctx.ResponseWriter, ctx.Server.cfg.CORSOrigin, http.StatusOK, map[string]string{"status": "ok"})
}

func handleConfig(ctx *Context) {
	body := "window.__APP_CONFIG__ = " + configJSON(ctx.Server.cfg.DemoMode) + ";\n"
	header := ctx.ResponseWriter.Header()
	applySecurityHeaders(header)
	header.Set("Content-Type", "application/javascript; charset=utf-8")
	header.Set("Cache-Control", "no-store")
	ctx.ResponseWriter.WriteHeader(http.StatusOK)
	_, _ = ctx.ResponseWriter.Write([]byte(body))
}

func (s *Server) handleMetrics(w http.ResponseWriter) {
	if s.cfg.Metrics != "enabled" {
		writeJSON(w, s.cfg.CORSOrigin, http.StatusNotFound, map[string]string{"error": "Not found"})
		return
	}
	applySecurityHeaders(w.Header())
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(s.metrics.Render(s.db != nil, s.schemaVersion)))
}


func (s *Server) requireDB() (*store.DB, error) {
	if s.db == nil {
		return nil, errors.New("database is not configured")
	}
	return s.db, nil
}

func (s *Server) authSettings(ctx context.Context) (store.AuthSettings, error) {
	db, err := s.requireDB()
	if err != nil {
		return store.AuthSettings{}, err
	}
	return db.GetAuthInstanceSettings(ctx)
}

func writeJSON(w http.ResponseWriter, corsOrigin string, status int, payload any) {
	header := w.Header()
	applyCORS(header, corsOrigin)
	applySecurityHeaders(header)
	header.Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func applyCORS(header http.Header, corsOrigin string) {
	header.Set("Access-Control-Allow-Origin", corsOrigin)
	header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	header.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
}

func applySecurityHeaders(header http.Header) {
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("X-Frame-Options", "DENY")
	header.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	header.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), serial=(self)")
	header.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org; font-src 'self'; connect-src 'self' https://nominatim.openstreetmap.org; object-src 'none'; base-uri 'self'; frame-ancestors 'none';")
}

func mustJSON(payload any) string {
	body, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}
	return string(body)
}

func configJSON(demoMode bool) string {
	if demoMode {
		return `{"authEnabled": true, "demoMode": true}`
	}
	return `{"authEnabled": true, "demoMode": false}`
}

func contentTypeError(contentTypes []string) string {
	if len(contentTypes) == 1 && contentTypes[0] == "application/json" {
		return "Content-Type must be application/json"
	}
	if contains(contentTypes, "text/csv") {
		return "Content-Type must be text/csv or application/json"
	}
	if contains(contentTypes, "application/gzip") {
		return "Content-Type must be application/xml, text/xml, application/gzip, or application/zip"
	}
	if contains(contentTypes, "application/zip") {
		return "Content-Type must be application/json or application/zip"
	}
	return "Content-Type is not supported"
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func readJSON(r *http.Request, dst any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain a single JSON value")
	}
	return nil
}

func badRequestMessage(err error) string {
	if err == nil {
		return "Invalid request"
	}
	message := strings.TrimSpace(err.Error())
	if message == "" {
		return "Invalid request"
	}
	return message
}

func userID() string {
	return "user_" + randomURLToken(16)
}

func randomURLToken(bytes int) string {
	value := make([]byte, bytes)
	if _, err := rand.Read(value); err != nil {
		return base64.RawURLEncoding.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return base64.RawURLEncoding.EncodeToString(value)
}

func inviteURL(token string) string {
	return "/?" + url.Values{"invite_token": []string{token}}.Encode()
}

func (s *Server) rateLimit(scope string) int {
	switch scope {
	case "auth_login":
		return s.cfg.RateLimitAuthLoginPerWindow
	case "auth_register":
		return s.cfg.RateLimitAuthRegisterPerWindow
	case "backup_import":
		return s.cfg.RateLimitBackupImportPerWindow
	case "dive_upload":
		return s.cfg.RateLimitDiveUploadPerWindow
	default:
		return 0
	}
}

func (s *Server) allowRateLimit(ctx context.Context, key string, limit int, windowSeconds int) (bool, int) {
	if s.db != nil {
		allowed, _, err := s.db.AllowRateLimit(ctx, key, limit, windowSeconds)
		if err == nil {
			if !allowed {
				return false, windowSeconds
			}
			return true, 0
		}
	}
	return s.limiter.Allow(key, limit, windowSeconds)
}

func isTrustedProxy(ip net.IP) bool {
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

func (s *Server) rawRemoteIP(r *http.Request) string {
	host := r.RemoteAddr
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}
	return host
}

func (s *Server) clientIP(r *http.Request) string {
	rawIP := s.rawRemoteIP(r)
	parsedRemote := net.ParseIP(rawIP)
	if s.cfg.TrustForwardedHeaders && isTrustedProxy(parsedRemote) {
		if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
			if parsed := net.ParseIP(realIP); parsed != nil {
				return parsed.String()
			}
		}
		if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
			first := strings.TrimSpace(strings.Split(forwarded, ",")[0])
			if parsed := net.ParseIP(first); parsed != nil {
				return parsed.String()
			}
		}
	}
	if parsedRemote != nil {
		return parsedRemote.String()
	}
	if rawIP == "" {
		return "unknown"
	}
	return rawIP
}

func (s *Server) isTrustedOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		referer := r.Header.Get("Referer")
		if referer != "" {
			if u, err := url.Parse(referer); err == nil && u.Scheme != "" && u.Host != "" {
				origin = u.Scheme + "://" + u.Host
			}
		}
	}
	if origin == "" {
		return false
	}
	if s.cfg.CORSOrigin != "" && strings.EqualFold(origin, s.cfg.CORSOrigin) {
		return true
	}
	scheme := "http"
	parsedRemote := net.ParseIP(s.rawRemoteIP(r))
	if r.TLS != nil || (s.cfg.TrustForwardedHeaders && isTrustedProxy(parsedRemote) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")) {
		scheme = "https"
	}
	host := r.Host
	if s.cfg.TrustForwardedHeaders && isTrustedProxy(parsedRemote) {
		if fHost := r.Header.Get("X-Forwarded-Host"); fHost != "" {
			host = strings.TrimSpace(strings.Split(fHost, ",")[0])
		}
	}
	expected := scheme + "://" + host
	return strings.EqualFold(origin, expected)
}


type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}
