import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  matchesAdminIdentity,
  resolveInitialAdminEmail,
} from '../lib/admin-policy'

describe('administrator policy', () => {
  test('authorizes only a verified, active database administrator role', () => {
    assert.equal(
      matchesAdminIdentity({
        email: 'owner@example.test',
        emailVerified: true,
        role: 'admin',
        banned: false,
      }),
      true,
    )
    assert.equal(
      matchesAdminIdentity({
        email: 'owner@example.test',
        emailVerified: false,
        role: 'admin',
        banned: false,
      }),
      false,
    )
    assert.equal(
      matchesAdminIdentity({
        email: 'owner@example.test',
        emailVerified: true,
        role: 'user',
        banned: false,
      }),
      false,
    )
    assert.equal(
      matchesAdminIdentity({
        email: 'owner@example.test',
        emailVerified: true,
        role: 'admin',
        banned: true,
      }),
      false,
    )
  })

  test('normalizes the optional bootstrap address and rejects invalid input', () => {
    const environment = { INITIAL_ADMIN_EMAIL: '  Owner@Example.TEST  ' }
    assert.equal(resolveInitialAdminEmail(environment), 'owner@example.test')
    assert.equal(resolveInitialAdminEmail({}), null)
    assert.throws(() => resolveInitialAdminEmail({ INITIAL_ADMIN_EMAIL: 'not-an-email' }))
  })
})
