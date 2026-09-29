// Local secret storage. Values are encrypted one by one with a cipher provided
// by the caller (Electron safeStorage in the app, a fake one in tests).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ConnectionOverride, ConnectionSecrets } from '@shared/types'
import { JsonStore } from './jsonStore'

export interface Cipher {
  encrypt(plain: string): string
  decrypt(encrypted: string): string
}

/** Electron safeStorage subset, so the module does not depend on Electron. */
export interface OsEncryption {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/**
 * Encrypts with the OS keyring when available. Without one (no secret service
 * running), falls back to AES-256-GCM with a key file readable only by the
 * user: it keeps passwords out of plain sight, not away from someone who can
 * read the user's files. Values are prefixed with the method used.
 */
export function createCipher(os: OsEncryption, keyFile: string): Cipher {
  let fileKey: Buffer | null = null
  const key = (): Buffer => {
    if (!fileKey) {
      if (existsSync(keyFile)) fileKey = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64')
      else {
        mkdirSync(dirname(keyFile), { recursive: true })
        fileKey = randomBytes(32)
        writeFileSync(keyFile, fileKey.toString('base64'), { mode: 0o600 })
      }
    }
    return fileKey
  }
  return {
    encrypt(plain) {
      if (os.isEncryptionAvailable()) return `os:${os.encryptString(plain).toString('base64')}`
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key(), iv)
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return `file:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`
    },
    decrypt(encrypted) {
      if (encrypted.startsWith('file:')) {
        const raw = Buffer.from(encrypted.slice(5), 'base64')
        const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
        decipher.setAuthTag(raw.subarray(12, 28))
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
      }
      return os.decryptString(Buffer.from(encrypted.replace(/^os:/, ''), 'base64'))
    }
  }
}

interface SecretsFile {
  secrets: Record<string, string>
  overrides: Record<string, ConnectionOverride>
}

export class SecretStore {
  private readonly store: JsonStore<SecretsFile>

  constructor(
    filePath: string,
    private readonly cipher: Cipher
  ) {
    this.store = new JsonStore<SecretsFile>(filePath, () => ({ secrets: {}, overrides: {} }))
  }

  private static key(repoId: string, connectionId: string): string {
    return `${repoId}:${connectionId}`
  }

  getSecrets(repoId: string, connectionId: string): ConnectionSecrets {
    return this.readSecrets(repoId, connectionId).secrets
  }

  /**
   * Secrets of a connection. `unreadable` means they are stored but cannot be
   * decrypted, typically because the OS keyring key changed: the encrypted
   * value is kept (it becomes readable again if the key comes back).
   */
  readSecrets(repoId: string, connectionId: string): { secrets: ConnectionSecrets; unreadable: boolean } {
    const encrypted = this.store.read().secrets[SecretStore.key(repoId, connectionId)]
    if (!encrypted) return { secrets: {}, unreadable: false }
    try {
      return { secrets: JSON.parse(this.cipher.decrypt(encrypted)) as ConnectionSecrets, unreadable: false }
    } catch (error) {
      console.warn(`Cannot decrypt the secrets of connection ${connectionId}: ${(error as Error).message}`)
      return { secrets: {}, unreadable: true }
    }
  }

  /** Stores secrets. Empty secrets never overwrite stored ones that cannot be decrypted. */
  setSecrets(repoId: string, connectionId: string, secrets: ConnectionSecrets): void {
    const cleaned = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value)) as ConnectionSecrets
    if (Object.keys(cleaned).length === 0 && this.readSecrets(repoId, connectionId).unreadable) return
    this.store.update((file) => {
      const key = SecretStore.key(repoId, connectionId)
      if (Object.keys(cleaned).length === 0) delete file.secrets[key]
      else file.secrets[key] = this.cipher.encrypt(JSON.stringify(cleaned))
    })
  }

  getOverride(repoId: string, connectionId: string): ConnectionOverride {
    return this.store.read().overrides[SecretStore.key(repoId, connectionId)] ?? {}
  }

  setOverride(repoId: string, connectionId: string, override: ConnectionOverride): void {
    this.store.update((file) => {
      const key = SecretStore.key(repoId, connectionId)
      if (!override.user) delete file.overrides[key]
      else file.overrides[key] = { user: override.user }
    })
  }

  forget(repoId: string, connectionId?: string): void {
    this.store.update((file) => {
      for (const map of [file.secrets, file.overrides] as Record<string, unknown>[]) {
        for (const key of Object.keys(map)) {
          if (connectionId ? key === SecretStore.key(repoId, connectionId) : key.startsWith(`${repoId}:`)) delete map[key]
        }
      }
    })
  }
}
