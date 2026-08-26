#!/usr/bin/env bash
# One-command declare+deploy for the maestro drips contract.
#
# Usage:
#   DEPLOY_NETWORK=sepolia \
#   DEPLOY_ACCOUNT=<sncast profile name from your snfoundry.toml> \
#   DRIPS_TOKEN_ADDRESS=0x... \
#   ./scripts/deploy.sh [--dry-run]
#
# Idempotent: skips declare when the compiled artifact is unchanged since the
# last run, and skips deploy when an address is already recorded. Records
# results into deployments.<network>.env.
set -euo pipefail

cd "$(dirname "$0")/.." # apps/contracts

NETWORK="${DEPLOY_NETWORK:-}"
PROFILE="${DEPLOY_ACCOUNT:-}"
TOKEN="${DRIPS_TOKEN_ADDRESS:-}"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

die() {
	echo "error: $*" >&2
	exit 1
}

# ── input validation (F4) ────────────────────────────────────────────────
[[ -n "$NETWORK" ]] || die "DEPLOY_NETWORK unset (sepolia|mainnet)"
case "$NETWORK" in
sepolia | mainnet) ;;
*) die "DEPLOY_NETWORK must be 'sepolia' or 'mainnet', got '$NETWORK'" ;;
esac
[[ -n "$PROFILE" ]] || die "DEPLOY_ACCOUNT unset (sncast profile name defined in your snfoundry.toml)"
[[ -n "$TOKEN" ]] || die "DRIPS_TOKEN_ADDRESS unset (the native token the stream pays out)"
[[ "$TOKEN" =~ ^0x[0-9a-fA-F]{1,76}$ ]] || die "DRIPS_TOKEN_ADDRESS must be a hex felt, got '$TOKEN'"

ENV_FILE="deployments.${NETWORK}.env"
# first run on a network: seed from the committed placeholder template
if [[ ! -f "$ENV_FILE" ]]; then
	cp "${ENV_FILE}.example" "$ENV_FILE"
fi
# shellcheck source=/dev/null
source "$ENV_FILE"

# Portable sha256 (macOS has shasum, Linux coreutils has sha256sum).
sha256_file() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	else
		shasum -a 256 "$1" | cut -d' ' -f1
	fi
}

# Upsert KEY=val into the deployments env file (portable across BSD/GNU sed).
upsert_env() {
	local key="$1" val="$2"
	if grep -qE "^${key}=" "$ENV_FILE"; then
		awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{$2=v; found=1} {print} END{if(!found) print k"="v}' \
			"$ENV_FILE" >"${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
	else
		printf '%s=%s\n' "$key" "$val" >>"$ENV_FILE"
	fi
}

# Run a command, echoing it first; no-op under --dry-run.
run() {
	echo "+ $*"
	if ! $DRY_RUN; then
		"$@"
	fi
}

echo "== [1/3] building =="
scarb build

ARTIFACT="target/dev/drips_Drips.contract_class.json"
[[ -f "$ARTIFACT" ]] || die "compiled artifact missing: $ARTIFACT"
ART_SHA="$(sha256_file "$ARTIFACT")"

echo "== [2/3] declare Drips on $NETWORK =="
CLASS_HASH="${DRIPS_CLASS_HASH:-}"
if [[ -n "$CLASS_HASH" && "${DRIPS_ARTIFACT_SHA:-}" == "$ART_SHA" ]]; then
	echo "artifact unchanged since last declare — skipping (F5)"
else
	if $DRY_RUN; then
		echo "+ sncast -p $PROFILE declare --contract-name Drips"
	else
		set +e
		DECLARE_OUT="$(sncast -p "$PROFILE" declare --contract-name Drips 2>&1)" # F2/F3 surface here
		DECLARE_EXIT=$?
		set -e
		echo "$DECLARE_OUT"

		# Extract class hash from success output OR from the already-declared
		# error message (both contain it).
		NEW_HASH="$(grep -Eo 'class_hash:[[:space:]]*0x[0-9a-fA-F]+' <<<"$DECLARE_OUT" |
			head -1 | grep -Eo '0x[0-9a-fA-F]+' || true)"
		if [[ -n "$NEW_HASH" ]]; then
			CLASS_HASH="$NEW_HASH"
		elif [[ "$DECLARE_EXIT" -ne 0 ]]; then
			die "declare failed and no class hash could be recovered (check funding/profile)"
		fi
		upsert_env "DRIPS_CLASS_HASH" "$CLASS_HASH"
		upsert_env "DRIPS_ARTIFACT_SHA" "$ART_SHA"
	fi
fi
echo "class hash: $CLASS_HASH"

echo "== [3/3] deploy Drips on $NETWORK =="
if [[ -n "${DRIPS_ADDRESS:-}" ]]; then
	echo "already deployed at ${DRIPS_ADDRESS} — skipping deploy"
	echo "(delete DRIPS_ADDRESS from ${ENV_FILE} to force a fresh deployment)"
else
	run sncast -p "$PROFILE" deploy --class-hash "$CLASS_HASH" \
		--constructor-calldata "$TOKEN"
	if ! $DRY_RUN; then
		DEPLOY_OUT="$(sncast -p "$PROFILE" deploy --class-hash "$CLASS_HASH" \
			--constructor-calldata "$TOKEN" 2>&1)"
		echo "$DEPLOY_OUT"
		CONTRACT_ADDR="$(grep -Eo 'contract_address:[[:space:]]*0x[0-9a-fA-F]+' <<<"$DEPLOY_OUT" |
			head -1 | grep -Eo '0x[0-9a-fA-F]+' || true)"
		DEPLOY_TX="$(grep -Eo 'transaction_hash:[[:space:]]*0x[0-9a-fA-F]+' <<<"$DEPLOY_OUT" |
			head -1 | grep -Eo '0x[0-9a-fA-F]+' || true)"
		[[ -n "$CONTRACT_ADDR" ]] || die "deploy did not yield a contract address"
		upsert_env "DRIPS_ADDRESS" "$CONTRACT_ADDR"
		upsert_env "DRIPS_DEPLOY_TX" "$DEPLOY_TX"
	fi
fi

echo ""
echo "== summary ($NETWORK) =="
echo "class hash : ${DRIPS_CLASS_HASH:-<unset>}"
echo "address    : ${DRIPS_ADDRESS:-<not deployed yet>}"
echo "deploy tx  : ${DRIPS_DEPLOY_TX:-<n/a>}"
$DRY_RUN && echo "(dry-run: nothing was sent to the network)"
