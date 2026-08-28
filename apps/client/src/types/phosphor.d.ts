// The hoisted @phosphor-icons/react types import 'react' from a directory where
// no @types/react is installed; with skipLibCheck the
// `extends ComponentPropsWithoutRef<'svg'>` silently drops, leaving IconProps
// without className/style. Re-declare the svg members the redacted UI uses.
import type { CSSProperties } from 'react'

declare module '@phosphor-icons/react' {
  interface IconProps {
    className?: string
    style?: CSSProperties
  }
}
export {}
