#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cargo >/dev/null || { echo 'Rust/Cargo is required (https://rustup.rs)' >&2; exit 1; }
command -v wasm-pack >/dev/null || { echo 'Install wasm-pack: cargo install wasm-pack --locked' >&2; exit 1; }
rustup target add wasm32-unknown-unknown
wasm-pack build packages/wasm --release --target web --out-dir pkg --out-name tokei_wasm --no-opt --locked
# Ship the shared engine so every app can build from a checkout/source archive.
rm -f packages/wasm/pkg/.gitignore
cargo test --manifest-path packages/wasm/Cargo.toml --lib --locked
npm test
