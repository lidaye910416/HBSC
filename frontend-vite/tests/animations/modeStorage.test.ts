import { describe, it, expect, beforeEach } from 'vitest'
import { getStorageKey, migrateLegacyStorage } from '../../src/components/ai/modeStorage'

describe('getStorageKey', () => {
  it('returns per-route per-mode key', () => {
    expect(getStorageKey('/articles/foo', 'ask')).toBe('hbsc.page-agent.chat.history:/articles/foo:ask')
    expect(getStorageKey('/articles/foo', 'operate')).toBe('hbsc.page-agent.chat.history:/articles/foo:operate')
  })

  it('treats different routes as different namespaces', () => {
    expect(getStorageKey('/a', 'ask')).not.toBe(getStorageKey('/b', 'ask'))
  })
})

describe('migrateLegacyStorage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('moves legacy global history into ask bucket and clears legacy key', () => {
    sessionStorage.setItem(
      'hbsc.page-agent.chat.history:/articles/foo',
      JSON.stringify([{ id: 1, role: 'user', content: 'hi' }]),
    )
    migrateLegacyStorage('/articles/foo')
    expect(sessionStorage.getItem('hbsc.page-agent.chat.history:/articles/foo:ask')).toBe(
      JSON.stringify([{ id: 1, role: 'user', content: 'hi', mode: 'ask' }]),
    )
    expect(sessionStorage.getItem('hbsc.page-agent.chat.history:/articles/foo')).toBeNull()
  })

  it('does not overwrite existing ask bucket', () => {
    sessionStorage.setItem(
      'hbsc.page-agent.chat.history:/articles/foo:ask',
      JSON.stringify([{ id: 99, role: 'user', content: 'new' }]),
    )
    sessionStorage.setItem(
      'hbsc.page-agent.chat.history:/articles/foo',
      JSON.stringify([{ id: 1, role: 'user', content: 'old' }]),
    )
    migrateLegacyStorage('/articles/foo')
    expect(sessionStorage.getItem('hbsc.page-agent.chat.history:/articles/foo:ask')).toBe(
      JSON.stringify([{ id: 99, role: 'user', content: 'new' }]),
    )
    expect(sessionStorage.getItem('hbsc.page-agent.chat.history:/articles/foo')).toBeNull()
  })

  it('is a no-op when no legacy key exists', () => {
    migrateLegacyStorage('/articles/foo')
    expect(sessionStorage.getItem('hbsc.page-agent.chat.history:/articles/foo:ask')).toBeNull()
  })
})
