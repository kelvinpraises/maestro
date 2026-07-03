#!/usr/bin/env bash
#
# Redeploy the four Maestro Soroban contracts to Stellar testnet and write the
# resulting IDs to apps/contracts/deployments.testnet.env.
#
# Prereqs:
#   - Stellar CLI v27 on PATH
#   - identity `maestro-deployer` exists and is funded on testnet
#   - contracts built: (cd apps/contracts && cargo build --target wasm32v1-none --release)
#
# Deploy order matters: the verifier and the native SAC must exist before
# zwerc20 is initialized (it stores both addresses at init).
set -euo pipefail

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_DIR="$REPO_ROOT/apps/contracts/target/wasm32v1-none/release"
OUT="$REPO_ROOT/apps/contracts/deployments.testnet.env"

SOURCE="maestro-deployer"
NETWORK="testnet"
ADMIN="$(stellar keys address "$SOURCE")"

# Global streams cycle length (seconds). The contract requires cycle_secs > 1
# (apps/contracts/drips/src/streams.rs::init), so the smallest legal value that keeps
# the product's "drips second-by-second" feel is 2.
CYCLE_SECS=2

echo "==> Deployer (admin/owner): $ADMIN"

# Native XLM Stellar Asset Contract — the underlying/token for zwerc20 & yield.
UNDERLYING="$(stellar contract id asset --asset native --network "$NETWORK")"
echo "==> Native SAC (UNDERLYING): $UNDERLYING"
# Ensure it is instantiated on-chain (idempotent; already live on testnet).
stellar contract asset deploy --asset native --source "$SOURCE" --network "$NETWORK" >/dev/null 2>&1 || true

deploy() {
  # deploy <wasm-basename>  -> prints the contract id
  stellar contract deploy \
    --wasm "$WASM_DIR/$1" \
    --source "$SOURCE" \
    --network "$NETWORK"
}

echo "==> [1/4] groth16_verifier (no init; vk embedded at build time)"
VERIFIER="$(deploy groth16_verifier.wasm)"
echo "    VERIFIER=$VERIFIER"

echo "==> [2/4] zwerc20"
ZWERC20="$(deploy zwerc20.wasm)"
echo "    ZWERC20=$ZWERC20"
stellar contract invoke --id "$ZWERC20" --source "$SOURCE" --network "$NETWORK" -- \
  init --admin "$ADMIN" --underlying "$UNDERLYING" --verifier "$VERIFIER"

echo "==> [3/4] drips (cycle_secs=$CYCLE_SECS)"
DRIPS="$(deploy drips.wasm)"
echo "    DRIPS=$DRIPS"
stellar contract invoke --id "$DRIPS" --source "$SOURCE" --network "$NETWORK" -- \
  init --cycle_secs "$CYCLE_SECS"

echo "==> [4/4] yield_manager"
YIELD="$(deploy yield_manager.wasm)"
echo "    YIELD=$YIELD"
stellar contract invoke --id "$YIELD" --source "$SOURCE" --network "$NETWORK" -- \
  init --owner "$ADMIN" --token "$UNDERLYING"

cat > "$OUT" <<EOF
VERIFIER=$VERIFIER
ZWERC20=$ZWERC20
DRIPS=$DRIPS
YIELD=$YIELD
UNDERLYING=$UNDERLYING
EOF

echo "==> Wrote $OUT:"
cat "$OUT"
