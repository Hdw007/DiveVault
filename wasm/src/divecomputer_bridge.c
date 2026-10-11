/*
 * DiveVault WebSerial libdivecomputer WebAssembly Bridge
 *
 * Connects libdivecomputer to browser Web Serial API using Emscripten Asyncify
 * and custom iostream callbacks (dc_custom_open).
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <stdint.h>
#include <stdarg.h>
#include <emscripten.h>

#include <libdivecomputer/context.h>
#include <libdivecomputer/descriptor.h>
#include <libdivecomputer/iterator.h>
#include <libdivecomputer/device.h>
#include <libdivecomputer/parser.h>
#include <libdivecomputer/custom.h>

static int ci_contains(const char *haystack, const char *needle) {
    if (!haystack || !needle) return 0;
    size_t hlen = strlen(haystack);
    size_t nlen = strlen(needle);
    if (nlen > hlen) return 0;
    for (size_t i = 0; i <= hlen - nlen; i++) {
        if (strncasecmp(haystack + i, needle, nlen) == 0) return 1;
    }
    return 0;
}

/* --- JavaScript imported bridges via EM_ASYNC_JS / EM_JS --- */

EM_ASYNC_JS(int, js_serial_configure, (unsigned int baudrate, unsigned int databits, int parity, int stopbits, int flowcontrol), {
    if (!Module.serialBridge || !Module.serialBridge.configure) return -1;
    return await Module.serialBridge.configure(baudrate, databits, parity, stopbits, flowcontrol);
});

EM_ASYNC_JS(int, js_serial_set_dtr, (int value), {
    if (!Module.serialBridge || !Module.serialBridge.setDtr) return 0;
    return await Module.serialBridge.setDtr(value);
});

EM_ASYNC_JS(int, js_serial_set_rts, (int value), {
    if (!Module.serialBridge || !Module.serialBridge.setRts) return 0;
    return await Module.serialBridge.setRts(value);
});

EM_ASYNC_JS(int, js_serial_set_break, (int value), {
    if (!Module.serialBridge || !Module.serialBridge.setBreak) return 0;
    return await Module.serialBridge.setBreak(value);
});

EM_ASYNC_JS(int, js_serial_read, (uint8_t *buffer, size_t size, size_t *actual, int timeout_ms), {
    if (!Module.serialBridge || !Module.serialBridge.read) return -1;
    const dest = HEAPU8.subarray(buffer, buffer + size);
    const res = await Module.serialBridge.read(dest, size, timeout_ms);
    if (res.status === 0) {
        if (actual) HEAP32[actual >> 2] = res.bytesRead;
        return 0; // DC_STATUS_SUCCESS
    }
    if (res.status === -7 || res.status === 4) {
        if (actual) HEAP32[actual >> 2] = 0;
        return -7; // DC_STATUS_TIMEOUT
    }
    if (actual) HEAP32[actual >> 2] = 0;
    return res.status || -6;
});

EM_ASYNC_JS(int, js_serial_write, (const uint8_t *buffer, size_t size, size_t *actual), {
    if (!Module.serialBridge || !Module.serialBridge.write) return -6;
    const src = HEAPU8.subarray(buffer, buffer + size);
    const res = await Module.serialBridge.write(src, size);
    if (res.status === 0) {
        if (actual) HEAP32[actual >> 2] = res.bytesWritten;
        return 0;
    }
    return res.status || -6;
});

EM_ASYNC_JS(int, js_serial_sleep, (unsigned int ms), {
    if (Module.serialBridge && Module.serialBridge.sleep) {
        await Module.serialBridge.sleep(ms);
    } else {
        await new Promise(r => setTimeout(r, ms));
    }
    return 0;
});

EM_ASYNC_JS(int, js_serial_close, (), {
    if (!Module.serialBridge || !Module.serialBridge.close) return 0;
    return await Module.serialBridge.close();
});

EM_JS(int, js_serial_is_cancelled, (), {
    if (Module.serialBridge && Module.serialBridge.isCancelled) {
        return Module.serialBridge.isCancelled() ? 1 : 0;
    }
    return 0;
});

EM_JS(void, js_emit_progress, (const char *stage_str, unsigned int current, unsigned int total), {
    if (Module.serialBridge && Module.serialBridge.onProgress) {
        Module.serialBridge.onProgress({
            stage: UTF8ToString(stage_str),
            current: current,
            total: total
        });
    }
});

EM_JS(void, js_emit_dive, (const char *json_meta, const uint8_t *raw_data, size_t raw_size, const uint8_t *fp_data, size_t fp_size), {
    if (Module.serialBridge && Module.serialBridge.onDive) {
        Module.serialBridge.onDive(UTF8ToString(json_meta), raw_data, raw_size, fp_data, fp_size);
    }
});

EM_JS(void, js_emit_complete, (const char *fingerprint_hex, int count), {
    if (Module.serialBridge && Module.serialBridge.onComplete) {
        Module.serialBridge.onComplete(UTF8ToString(fingerprint_hex), count);
    }
});

/* --- Bridge Internal State --- */

typedef struct {
    int timeout_ms;
} bridge_io_state_t;

static bridge_io_state_t g_io_state = { 3000 };

static dc_status_t cb_set_timeout(void *userdata, int timeout) {
    bridge_io_state_t *st = (bridge_io_state_t *)userdata;
    if (st) st->timeout_ms = timeout;
    return DC_STATUS_SUCCESS;
}

static dc_status_t cb_set_dtr(void *userdata, unsigned int value) {
    return (dc_status_t)js_serial_set_dtr((int)value);
}

static dc_status_t cb_set_rts(void *userdata, unsigned int value) {
    return (dc_status_t)js_serial_set_rts((int)value);
}

static dc_status_t cb_set_break(void *userdata, unsigned int value) {
    return (dc_status_t)js_serial_set_break((int)value);
}

static dc_status_t cb_configure(void *userdata, unsigned int baudrate, unsigned int databits, dc_parity_t parity, dc_stopbits_t stopbits, dc_flowcontrol_t flowcontrol) {
    return (dc_status_t)js_serial_configure(baudrate, databits, (int)parity, (int)stopbits, (int)flowcontrol);
}

static dc_status_t cb_read(void *userdata, void *data, size_t size, size_t *actual) {
    bridge_io_state_t *st = (bridge_io_state_t *)userdata;
    int timeout = st ? st->timeout_ms : 3000;
    return (dc_status_t)js_serial_read((uint8_t *)data, size, actual, timeout);
}

static dc_status_t cb_write(void *userdata, const void *data, size_t size, size_t *actual) {
    return (dc_status_t)js_serial_write((const uint8_t *)data, size, actual);
}

static dc_status_t cb_sleep(void *userdata, unsigned int milliseconds) {
    return (dc_status_t)js_serial_sleep(milliseconds);
}

static dc_status_t cb_close(void *userdata) {
    return (dc_status_t)js_serial_close();
}

static const dc_custom_cbs_t g_custom_cbs = {
    cb_set_timeout,
    cb_set_break,
    cb_set_dtr,
    cb_set_rts,
    NULL, /* get_lines */
    NULL, /* get_available */
    cb_configure,
    NULL, /* poll */
    cb_read,
    cb_write,
    NULL, /* ioctl */
    NULL, /* flush */
    NULL, /* purge */
    cb_sleep,
    cb_close
};

static int cb_cancel(void *userdata) {
    return js_serial_is_cancelled();
}

static void cb_event(dc_device_t *device, dc_event_type_t event, const void *data, void *userdata) {
    if (event == DC_EVENT_PROGRESS) {
        const dc_event_progress_t *p = (const dc_event_progress_t *)data;
        js_emit_progress("reading", p->current, p->maximum);
    } else if (event == DC_EVENT_WAITING) {
        js_emit_progress("waiting", 0, 100);
    }
}

/* Dynamic string buffer helper for JSON formatting */
typedef struct {
    char *data;
    size_t size;
    size_t capacity;
} json_buf_t;

static void json_buf_init(json_buf_t *b) {
    b->capacity = 4096;
    b->size = 0;
    b->data = (char *)malloc(b->capacity);
    if (b->data) b->data[0] = '\0';
}

static void json_buf_free(json_buf_t *b) {
    if (b->data) free(b->data);
    b->data = NULL;
    b->size = b->capacity = 0;
}

static void json_buf_append(json_buf_t *b, const char *fmt, ...) {
    va_list args;
    va_start(args, fmt);
    va_list copy;
    va_copy(copy, args);
    int needed = vsnprintf(NULL, 0, fmt, copy);
    va_end(copy);
    if (needed < 0) {
        va_end(args);
        return;
    }
    while (b->size + (size_t)needed + 1 > b->capacity) {
        b->capacity *= 2;
        b->data = (char *)realloc(b->data, b->capacity);
    }
    vsnprintf(b->data + b->size, b->capacity - b->size, fmt, args);
    b->size += needed;
    va_end(args);
}

/* Sample accumulator structure */
typedef struct {
    json_buf_t buf;
    int first_sample;
    int has_active_sample;
    double current_time;
    double current_depth;
    double current_temp;
    int has_temp;
    double current_pressure;
    int has_pressure;
    int current_rbt;
    int has_rbt;
    int current_heartbeat;
    int has_heartbeat;
    int current_bearing;
    int has_bearing;
} sample_collector_t;

static void sample_collector_flush(sample_collector_t *sc) {
    if (!sc->has_active_sample) return;
    if (!sc->first_sample) {
        json_buf_append(&sc->buf, ",");
    }
    sc->first_sample = 0;
    json_buf_append(&sc->buf, "{\"time_seconds\":%.1f,\"depth_m\":%.2f", sc->current_time, sc->current_depth);
    if (sc->has_temp) {
        json_buf_append(&sc->buf, ",\"temperature_c\":%.1f", sc->current_temp);
    }
    if (sc->has_pressure) {
        json_buf_append(&sc->buf, ",\"tank_pressure_bar\":%.1f", sc->current_pressure);
    }
    if (sc->has_rbt) {
        json_buf_append(&sc->buf, ",\"rbt_seconds\":%d", sc->current_rbt);
    }
    if (sc->has_heartbeat) {
        json_buf_append(&sc->buf, ",\"heartbeat_bpm\":%d", sc->current_heartbeat);
    }
    if (sc->has_bearing) {
        json_buf_append(&sc->buf, ",\"bearing_degrees\":%d", sc->current_bearing);
    }
    json_buf_append(&sc->buf, "}");
    sc->has_active_sample = 0;
    sc->has_temp = 0;
    sc->has_pressure = 0;
    sc->has_rbt = 0;
    sc->has_heartbeat = 0;
    sc->has_bearing = 0;
}

static void cb_sample(dc_sample_type_t type, const dc_sample_value_t *v, void *userdata) {
    sample_collector_t *sc = (sample_collector_t *)userdata;
    switch (type) {
    case DC_SAMPLE_TIME:
        if (sc->has_active_sample) {
            sample_collector_flush(sc);
        }
        sc->current_time = (double)v->time / 1000.0; /* libdivecomputer 0.9.0 reports ms */
        sc->current_depth = 0.0;
        sc->has_active_sample = 1;
        break;
    case DC_SAMPLE_DEPTH:
        sc->current_depth = v->depth;
        sc->has_active_sample = 1;
        break;
    case DC_SAMPLE_PRESSURE:
        sc->current_pressure = v->pressure.value;
        sc->has_pressure = 1;
        break;
    case DC_SAMPLE_TEMPERATURE:
        sc->current_temp = v->temperature;
        sc->has_temp = 1;
        break;
    case DC_SAMPLE_RBT:
        sc->current_rbt = v->rbt;
        sc->has_rbt = 1;
        break;
    case DC_SAMPLE_HEARTBEAT:
        sc->current_heartbeat = v->heartbeat;
        sc->has_heartbeat = 1;
        break;
    case DC_SAMPLE_BEARING:
        sc->current_bearing = v->bearing;
        sc->has_bearing = 1;
        break;
    default:
        break;
    }
}

typedef struct {
    dc_device_t *device;
    const char *vendor;
    const char *product;
    int dive_count;
    char latest_fingerprint[128];
} dive_collector_state_t;

static int cb_dive(const unsigned char *data, unsigned int size, const unsigned char *fp, unsigned int fsize, void *userdata) {
    dive_collector_state_t *st = (dive_collector_state_t *)userdata;
    dc_parser_t *parser = NULL;

    dc_status_t rc = dc_parser_new(&parser, st->device, data, size);
    if (rc != DC_STATUS_SUCCESS) {
        return 1; /* Continue with other dives */
    }

    char started_at[64] = "";
    dc_datetime_t dt;
    if (dc_parser_get_datetime(parser, &dt) == DC_STATUS_SUCCESS) {
        snprintf(started_at, sizeof(started_at), "%04d-%02d-%02dT%02d:%02d:%02d",
                 dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second);
    }

    unsigned int divetime = 0;
    dc_parser_get_field(parser, DC_FIELD_DIVETIME, 0, &divetime);

    double maxdepth = 0.0;
    dc_parser_get_field(parser, DC_FIELD_MAXDEPTH, 0, &maxdepth);

    double avgdepth = 0.0;
    dc_parser_get_field(parser, DC_FIELD_AVGDEPTH, 0, &avgdepth);

    double temp_min = 0.0;
    int has_temp = (dc_parser_get_field(parser, DC_FIELD_TEMPERATURE_MINIMUM, 0, &temp_min) == DC_STATUS_SUCCESS);

    double atmospheric = 0.0;
    int has_atm = (dc_parser_get_field(parser, DC_FIELD_ATMOSPHERIC, 0, &atmospheric) == DC_STATUS_SUCCESS);

    /* Collect samples */
    sample_collector_t sc;
    json_buf_init(&sc.buf);
    sc.first_sample = 1;
    sc.has_active_sample = 0;
    json_buf_append(&sc.buf, "[");

    dc_parser_samples_foreach(parser, cb_sample, &sc);
    sample_collector_flush(&sc);
    json_buf_append(&sc.buf, "]");

    /* Assemble dive metadata JSON */
    json_buf_t meta;
    json_buf_init(&meta);
    json_buf_append(&meta, "{\"started_at\":\"%s\",\"duration_seconds\":%u,\"max_depth_m\":%.2f,\"avg_depth_m\":%.2f",
                    started_at, divetime, maxdepth, avgdepth);
    json_buf_append(&meta, ",\"fields\":{\"divetime_seconds\":%u,\"max_depth_m\":%.2f,\"avg_depth_m\":%.2f",
                    divetime, maxdepth, avgdepth);
    if (has_temp) {
        json_buf_append(&meta, ",\"water_temperature_c\":%.1f", temp_min);
    }
    if (has_atm) {
        json_buf_append(&meta, ",\"atmospheric_bar\":%.3f", atmospheric);
    }
    json_buf_append(&meta, "},\"samples\":%s}", sc.buf.data);

    /* Emit dive to JavaScript */
    js_emit_dive(meta.data, data, size, fp, fsize);

    /* Record latest fingerprint hex */
    if (fsize > 0 && fp) {
        size_t hex_len = 0;
        for (unsigned int i = 0; i < fsize && hex_len + 3 < sizeof(st->latest_fingerprint); ++i) {
            hex_len += snprintf(st->latest_fingerprint + hex_len, sizeof(st->latest_fingerprint) - hex_len, "%02x", fp[i]);
        }
    }

    st->dive_count++;

    json_buf_free(&meta);
    json_buf_free(&sc.buf);
    dc_parser_destroy(parser);

    return 1; /* Continue */
}

/* --- Public C API exported to WebAssembly --- */

EMSCRIPTEN_KEEPALIVE
int dc_bridge_init(void) {
    return 0;
}

EMSCRIPTEN_KEEPALIVE
char* dc_bridge_list_models(void) {
    dc_context_t *ctx = NULL;
    if (dc_context_new(&ctx) != DC_STATUS_SUCCESS) {
        return strdup("[]");
    }

    dc_iterator_t *it = NULL;
    if (dc_descriptor_iterator_new(&it, ctx) != DC_STATUS_SUCCESS) {
        dc_context_free(ctx);
        return strdup("[]");
    }

    json_buf_t b;
    json_buf_init(&b);
    json_buf_append(&b, "[");
    int first = 1;

    dc_descriptor_t *d = NULL;
    while (dc_iterator_next(it, (void **)&d) == DC_STATUS_SUCCESS) {
        if (dc_descriptor_get_transports(d) & DC_TRANSPORT_SERIAL) {
            const char *vendor = dc_descriptor_get_vendor(d);
            const char *product = dc_descriptor_get_product(d);
            if (vendor && product) {
                if (!first) json_buf_append(&b, ",");
                first = 0;
                json_buf_append(&b, "{\"vendor\":\"%s\",\"product\":\"%s\"}", vendor, product);
            }
        }
        dc_descriptor_free(d);
    }

    json_buf_append(&b, "]");
    dc_iterator_free(it);
    dc_context_free(ctx);

    char *res = strdup(b.data);
    json_buf_free(&b);
    return res;
}

static unsigned char hex_byte(char hi, char lo) {
    char str[3] = { hi, lo, '\0' };
    return (unsigned char)strtoul(str, NULL, 16);
}

EMSCRIPTEN_KEEPALIVE
int dc_bridge_download(const char *vendor, const char *product, const char *fingerprint_hex) {
    if (!vendor || !product) return DC_STATUS_INVALIDARGS;

    dc_context_t *ctx = NULL;
    dc_status_t rc = dc_context_new(&ctx);
    if (rc != DC_STATUS_SUCCESS) return rc;

    /* Find matching descriptor */
    dc_iterator_t *it = NULL;
    rc = dc_descriptor_iterator_new(&it, ctx);
    if (rc != DC_STATUS_SUCCESS) {
        dc_context_free(ctx);
        return rc;
    }

    dc_descriptor_t *found = NULL;
    dc_descriptor_t *d = NULL;
    while (dc_iterator_next(it, (void **)&d) == DC_STATUS_SUCCESS) {
        if (strcasecmp(dc_descriptor_get_vendor(d), vendor) == 0 &&
            strcmp(dc_descriptor_get_product(d), product) == 0) {
            found = d;
            break;
        }
        dc_descriptor_free(d);
    }
    dc_iterator_free(it);

    /* Fallback pass: case-insensitive substring/prefix match */
    if (!found) {
        if (dc_descriptor_iterator_new(&it, ctx) == DC_STATUS_SUCCESS) {
            while (dc_iterator_next(it, (void **)&d) == DC_STATUS_SUCCESS) {
                if (strcasecmp(dc_descriptor_get_vendor(d), vendor) == 0) {
                    const char *p = dc_descriptor_get_product(d);
                    if (strcasecmp(p, product) == 0 ||
                        ci_contains(p, product) ||
                        ci_contains(product, p)) {
                        found = d;
                        break;
                    }
                }
                dc_descriptor_free(d);
            }
            dc_iterator_free(it);
        }
    }

    if (!found) {
        dc_context_free(ctx);
        return DC_STATUS_NODEVICE;
    }

    /* Open custom iostream stream connecting to WebSerial */
    dc_iostream_t *iostream = NULL;
    rc = dc_custom_open(&iostream, ctx, DC_TRANSPORT_SERIAL, &g_custom_cbs, &g_io_state);
    if (rc != DC_STATUS_SUCCESS) {
        dc_descriptor_free(found);
        dc_context_free(ctx);
        return rc;
    }

    /* Open dive computer device */
    dc_device_t *device = NULL;
    rc = dc_device_open(&device, ctx, found, iostream);
    if (rc != DC_STATUS_SUCCESS) {
        dc_iostream_close(iostream);
        dc_descriptor_free(found);
        dc_context_free(ctx);
        return rc;
    }

    /* Set fingerprint if provided */
    if (fingerprint_hex && strlen(fingerprint_hex) > 0) {
        size_t hex_len = strlen(fingerprint_hex);
        if (hex_len % 2 == 0) {
            size_t fp_len = hex_len / 2;
            unsigned char *fp_bytes = (unsigned char *)malloc(fp_len);
            for (size_t i = 0; i < fp_len; ++i) {
                fp_bytes[i] = hex_byte(fingerprint_hex[i * 2], fingerprint_hex[i * 2 + 1]);
            }
            dc_device_set_fingerprint(device, fp_bytes, fp_len);
            free(fp_bytes);
        }
    }

    /* Set cancel and event callbacks */
    dc_device_set_cancel(device, cb_cancel, NULL);
    dc_device_set_events(device, DC_EVENT_PROGRESS | DC_EVENT_WAITING, cb_event, NULL);

    dive_collector_state_t state;
    memset(&state, 0, sizeof(state));
    state.device = device;
    state.vendor = vendor;
    state.product = product;

    js_emit_progress("starting", 0, 100);

    /* Foreach dive download */
    rc = dc_device_foreach(device, cb_dive, &state);

    /* Notify completion */
    js_emit_complete(state.latest_fingerprint, state.dive_count);

    /* Cleanup */
    dc_device_close(device);
    dc_iostream_close(iostream);
    dc_descriptor_free(found);
    dc_context_free(ctx);

    return rc;
}
