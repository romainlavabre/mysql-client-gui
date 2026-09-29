import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SecretStore, createCipher, type OsEncryption } from '../../src/main/secrets'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcg-secrets-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const noKeyring: OsEncryption = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error('Encryption is not available')
  },
  decryptString: () => {
    throw new Error('Encryption is not available')
  }
}

const fakeKeyring: OsEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain).reverse(),
  decryptString: (encrypted) => Buffer.from(encrypted).reverse().toString()
}

describe('createCipher', () => {
  it('uses the OS keyring when available', () => {
    const cipher = createCipher(fakeKeyring, join(dir, 'key'))
    const encrypted = cipher.encrypt('secret')
    expect(encrypted.startsWith('os:')).toBe(true)
    expect(cipher.decrypt(encrypted)).toBe('secret')
  })

  it('falls back to a private key file without keyring', () => {
    const keyFile = join(dir, 'key')
    const encrypted = createCipher(noKeyring, keyFile).encrypt('p@ss')
    expect(encrypted.startsWith('file:')).toBe(true)
    expect(encrypted).not.toContain('p@ss')
    expect(statSync(keyFile).mode & 0o777).toBe(0o600)
    // A new instance reads the same key.
    expect(createCipher(noKeyring, keyFile).decrypt(encrypted)).toBe('p@ss')
  })
})

describe('SecretStore', () => {
  it('stores secrets per workspace and connection, and forgets them', () => {
    const store = new SecretStore(join(dir, 'secrets.json'), createCipher(noKeyring, join(dir, 'key')))
    store.setSecrets('repo', 'c1', { password: 'a', sshPassword: '' })
    store.setOverride('repo', 'c1', { user: 'me' })
    expect(store.getSecrets('repo', 'c1')).toEqual({ password: 'a' })
    expect(store.getSecrets('other', 'c1')).toEqual({})
    expect(store.getOverride('repo', 'c1')).toEqual({ user: 'me' })
    store.forget('repo')
    expect(store.getSecrets('repo', 'c1')).toEqual({})
    expect(store.getOverride('repo', 'c1')).toEqual({})
  })
})
