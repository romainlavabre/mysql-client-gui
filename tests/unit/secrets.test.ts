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

describe('undecryptable secrets', () => {
  it('reports them and never wipes them with an empty save', () => {
    let keyringKey = 'k1'
    const rotating: OsEncryption = {
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(`${keyringKey}|${plain}`),
      decryptString: (encrypted) => {
        const [key, plain] = encrypted.toString().split('|')
        if (key !== keyringKey) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
        return plain
      }
    }
    const store = new SecretStore(join(dir, 'secrets.json'), createCipher(rotating, join(dir, 'key')))
    store.setSecrets('repo', 'c1', { password: 'p@ss' })

    keyringKey = 'k2' // The keyring key changed.
    expect(store.readSecrets('repo', 'c1')).toEqual({ secrets: {}, unreadable: true })
    store.setSecrets('repo', 'c1', {}) // Saving the form without retyping.

    keyringKey = 'k1' // The key comes back: nothing was lost.
    expect(store.readSecrets('repo', 'c1')).toEqual({ secrets: { password: 'p@ss' }, unreadable: false })

    keyringKey = 'k2'
    store.setSecrets('repo', 'c1', { password: 'new' }) // Retyped: replaced.
    expect(store.readSecrets('repo', 'c1')).toEqual({ secrets: { password: 'new' }, unreadable: false })
  })
})
