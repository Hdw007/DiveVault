#!/usr/bin/env bash
set -euo pipefail

# Build script for compiling libdivecomputer to WebAssembly using Emscripten.
# Outputs: frontend/public/wasm/libdivecomputer.wasm and frontend/public/wasm/libdivecomputer.js

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${REPO_ROOT}/.build-wasm"
DIST_DIR="${REPO_ROOT}/frontend/public/wasm"
LDC_VERSION="0.9.0"
LDC_TAR="libdivecomputer-${LDC_VERSION}.tar.gz"
LDC_URL="https://libdivecomputer.org/releases/${LDC_TAR}"

mkdir -p "${BUILD_DIR}" "${DIST_DIR}"

# Ensure emsdk is in PATH
if ! command -v emcc &>/dev/null; then
    if [ -f "/tmp/emsdk/emsdk_env.sh" ]; then
        source "/tmp/emsdk/emsdk_env.sh"
    elif [ -n "${EMSDK:-}" ] && [ -f "${EMSDK}/emsdk_env.sh" ]; then
        source "${EMSDK}/emsdk_env.sh"
    else
        echo "Error: emcc not found. Please ensure emsdk is installed and activated." >&2
        exit 1
    fi
fi

# 1. Download libdivecomputer source if missing
if [ ! -d "${BUILD_DIR}/libdivecomputer-${LDC_VERSION}" ]; then
    echo "Downloading libdivecomputer ${LDC_VERSION}..."
    curl -sSL "${LDC_URL}" | tar -xz -C "${BUILD_DIR}"
fi

LDC_SRC="${BUILD_DIR}/libdivecomputer-${LDC_VERSION}"
INSTALL_DIR="${BUILD_DIR}/install"

# 2. Patch serial_posix.c for Emscripten virtual POSIX compatibility
if grep -q "!defined(__ANDROID__)" "${LDC_SRC}/src/serial_posix.c" && ! grep -q "!defined(__EMSCRIPTEN__)" "${LDC_SRC}/src/serial_posix.c"; then
    echo "Patching serial_posix.c for Emscripten..."
    sed -i 's/!defined(__ANDROID__)/!defined(__ANDROID__) \&\& !defined(__EMSCRIPTEN__)/g' "${LDC_SRC}/src/serial_posix.c"
fi

# 3. Configure and compile libdivecomputer.a
if [ ! -f "${INSTALL_DIR}/lib/libdivecomputer.a" ]; then
    echo "Configuring and compiling libdivecomputer static library..."
    cd "${LDC_SRC}"
    emconfigure ./configure \
        --prefix="${INSTALL_DIR}" \
        --without-libusb \
        --without-hidapi \
        --without-bluez \
        --enable-examples=no \
        --enable-doc=no \
        --disable-shared \
        --enable-static \
        CFLAGS="-O3"

    emmake make -j"$(nproc 2>/dev/null || echo 4)"
    emmake make install
fi

# 4. Compile Wasm bridge
echo "Compiling WebAssembly bridge with Asyncify..."
cd "${REPO_ROOT}"
emcc "${REPO_ROOT}/wasm/src/divecomputer_bridge.c" \
    -I"${INSTALL_DIR}/include" \
    "${INSTALL_DIR}/lib/libdivecomputer.a" \
    -o "${DIST_DIR}/libdivecomputer.js" \
    -sASYNCIFY=1 \
    -sMODULARIZE=1 \
    -sEXPORT_NAME="createDiveComputerModule" \
    -sEXPORTED_FUNCTIONS="['_malloc','_free','_dc_bridge_init','_dc_bridge_list_models','_dc_bridge_download']" \
    -sEXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','stringToUTF8']" \
    -sEXPORT_ES6=1 \
    -O3

echo "WebAssembly build complete: ${DIST_DIR}/libdivecomputer.js & ${DIST_DIR}/libdivecomputer.wasm"

