#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v cargo >/dev/null || { echo 'Rust/Cargo is required (https://rustup.rs)' >&2; exit 1; }
command -v wasm-pack >/dev/null || { echo 'Install wasm-pack: cargo install wasm-pack --locked' >&2; exit 1; }
rustup target add wasm32-unknown-unknown
wasm-pack build wasm --release --target web --out-dir ../docs/pkg --out-name tokei_wasm --no-opt --locked
# Ship the built engine with the app so a checkout/source archive is runnable.
rm -f docs/pkg/.gitignore
cargo test --manifest-path wasm/Cargo.toml --lib --locked
node --test tests/*.test.mjs
