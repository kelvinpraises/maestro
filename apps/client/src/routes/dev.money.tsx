import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { WalletAccountV6 } from 'starknet'
import { useWallet } from '#/lib/walletStore'
import { chainName, trimAddress } from '#/lib/starknet'
import { shield, unshield, privateTransfer, shieldedBalances } from '#/lib/strk20'
import { DEV_SHIELD_AMOUNT } from '#/lib/strk20-actions'

export const Route = createFileRoute('/dev/money')({ component: DevMoney })

// STRK mainnet + sepolia token addresses; per-chain env override wins.
const STRK_TOKENS: Record<string, string> = {
  '0x534e5f4d41494e': '0x4718f5a0fc347c97dcbf3b4f216a47cbd1f1067ebb3f2753f45e3028ec6f5a72',
  '0x534e5f5345504f4c4941': '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
}

function strkToken(chainId: string | null): string {
  const envKey = chainId === '0x534e5f4d41494e' ? 'VITE_STRK_TOKEN_MAINNET' : 'VITE_STRK_TOKEN_SEPOLIA'
  return import.meta.env[envKey] || (chainId ? STRK_TOKENS[chainId] : undefined) || ''
}

function DevMoney() {
  // Env-gated: never ships to the production demo.
  if (import.meta.env.VITE_ENABLE_DEV_MONEY !== '1') {
    return <p className="p-8 text-sm text-zinc-500">Set VITE_ENABLE_DEV_MONEY=1 in .env.local to enable.</p>
  }
  return <MoneyMoves />
}

function MoneyMoves() {
  const { account, chainId } = useWallet()
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const [recipient, setRecipient] = useState('')

  if (!account || !chainId) {
    return (
      <div className="p-8 text-sm">
        Connect a wallet first (button in the header). Current chain: {chainId ? chainName(chainId) : 'none'}
      </div>
    )
  }

  const token = strkToken(chainId)

  function log(line: string) {
    setOut((o) => `${o}\n${line}`)
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true)
    log(`— ${label} —`)
    try {
      await fn()
    } catch (e) {
      log(`ERROR: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const selfRecipient = recipient.trim() || account.address

  return (
    <div className="max-w-2xl p-8 text-sm">
      <h1 className="mb-2 font-semibold">dev/money — raw STRK20 ops</h1>
      <p>
        wallet {trimAddress(account.address)} on {chainName(chainId)} · token{' '}
        <code className="text-xs">{token ? trimAddress(token) : 'UNCONFIGURED'}</code>
      </p>

      <label className="mt-3 block text-xs text-zinc-500">
        recipient for withdraw/private-transfer (defaults to self; must be a REGISTERED pool user — sender is
        auto-registered by the wallet on first use)
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x…"
          className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={() =>
            run('shield 0.01 STRK', async () => {
              // Two wallet prompts: ERC-20 approve lands first, then the deposit.
              const r = await shield(account as WalletAccountV6, chainId, token, DEV_SHIELD_AMOUNT)
              log(`shield ${r.status}: ${r.hash}${r.status === 'submitted' ? ' (not yet visible at RPC — keep polling)' : ''}`)
              log('note matures ~10 blocks before spendable.')
            })
          }
          className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          Shield 0.01 STRK
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run('list shielded balances', async () => {
              const b = await shieldedBalances(account as WalletAccountV6)
              log(b.length ? JSON.stringify(b, null, 2) : '(no shielded balances)')
            })
          }
          className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-50 dark:border-zinc-700"
        >
          List balances
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run('unshield 0.01 STRK → recipient', async () => {
              const r = await unshield(account as WalletAccountV6, chainId, token, DEV_SHIELD_AMOUNT, selfRecipient)
              log(`unshield ${r.status}: ${r.hash}`)
            })
          }
          className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-50 dark:border-zinc-700"
        >
          Unshield
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run('private transfer 0.01 STRK → recipient', async () => {
              const r = await privateTransfer(account as WalletAccountV6, chainId, token, DEV_SHIELD_AMOUNT, selfRecipient)
              log(`private transfer ${r.status}: ${r.hash}`)
            })
          }
          className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-50 dark:border-zinc-700"
        >
          Private transfer
        </button>
      </div>

      <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
        {out.trim() || '(output appears here)'}
      </pre>
    </div>
  )
}
