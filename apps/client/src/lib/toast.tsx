import { useSyncExternalStore } from 'react'

// Minimal toast system — no dependency. toast(msg, kind) shows a card-pop pill
// for 4s; <Toasts /> renders them (mounted once in the root route).

export interface Toast {
  id: number
  msg: string
  kind: 'info' | 'error'
}

let toasts: Toast[] = []
const listeners = new Set<() => void>()
let nextId = 1

export function toast(msg: string, kind: Toast['kind'] = 'info') {
  const t = { id: nextId++, msg, kind }
  toasts = [...toasts, t]
  listeners.forEach((l) => l())
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id)
    listeners.forEach((l) => l())
  }, 4000)
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function Toasts() {
  const list = useSyncExternalStore(subscribe, () => toasts)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 mx-auto flex max-w-[360px] flex-col gap-2 px-4">
      {list.map((t) => (
        <div
          key={t.id}
          className="card-pop !py-2 text-center text-sm font-bold"
          style={t.kind === 'error' ? { background: 'var(--m-pink)' } : { background: 'var(--m-green)' }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}
