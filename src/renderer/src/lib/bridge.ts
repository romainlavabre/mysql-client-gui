// Access to the main process API exposed by the preload script.
import { cleanIpcError } from '@shared/api'

export const api = window.bridge.api
export const onEvent = window.bridge.on

export function errorMessage(error: unknown): string {
  return cleanIpcError(error)
}
