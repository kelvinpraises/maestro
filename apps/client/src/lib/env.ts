// Centralized vite env reads (typed loosely — env vars are just strings).
export const BOARD_URL = import.meta.env.VITE_BOARD_URL || 'http://localhost:8787'
export const DEV_MONEY_ENABLED = import.meta.env.VITE_ENABLE_DEV_MONEY === '1'
