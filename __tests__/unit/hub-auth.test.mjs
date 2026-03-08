/**
 * Unit tests for village/lib/auth.js
 *
 * Tests safeEqual, validateToken, and requireSecret.
 * Note: auth.test.mjs already covers validateObserverAuth from logic.js — this
 * file covers the hub's own auth helpers.
 */

import { describe, it, expect } from 'vitest';
import { safeEqual, validateToken, requireSecret } from '../../lib/auth.js';

// ─── safeEqual ────────────────────────────────────────────────────────────────

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(safeEqual('abc', 'xyz')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abcd', 'abc')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(safeEqual('', 'abc')).toBe(false);
    expect(safeEqual('abc', '')).toBe(false);
  });

  it('returns true for empty vs empty', () => {
    expect(safeEqual('', '')).toBe(true);
  });

  it('returns false for non-string inputs', () => {
    expect(safeEqual(null, 'abc')).toBe(false);
    expect(safeEqual('abc', null)).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
    expect(safeEqual(123, 123)).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(safeEqual('ABC', 'abc')).toBe(false);
    expect(safeEqual('Token', 'token')).toBe(false);
  });

  it('handles Bearer token format comparison', () => {
    const secret = 'my-secret-token';
    expect(safeEqual(`Bearer ${secret}`, `Bearer ${secret}`)).toBe(true);
    expect(safeEqual(`Bearer ${secret}`, `Bearer wrong`)).toBe(false);
  });
});

// ─── validateToken ────────────────────────────────────────────────────────────

function makeTokenManager(tokens = {}) {
  return {
    async read() { return tokens; },
  };
}

function makeReq(authHeader) {
  return { headers: { authorization: authHeader || '' } };
}

describe('validateToken', () => {
  it('returns { botName, displayName } for valid vtk_ token', async () => {
    const tm = makeTokenManager({
      'vtk_abc123': { botName: 'alice', displayName: 'Alice' },
    });
    const result = await validateToken(makeReq('Bearer vtk_abc123'), tm);
    expect(result).toEqual({ botName: 'alice', displayName: 'Alice' });
  });

  it('falls back to botName when displayName is missing', async () => {
    const tm = makeTokenManager({
      'vtk_abc123': { botName: 'alice' },
    });
    const result = await validateToken(makeReq('Bearer vtk_abc123'), tm);
    expect(result).toEqual({ botName: 'alice', displayName: 'alice' });
  });

  it('returns null for missing Authorization header', async () => {
    const tm = makeTokenManager({ 'vtk_abc123': { botName: 'alice' } });
    const result = await validateToken(makeReq(''), tm);
    expect(result).toBeNull();
  });

  it('returns null for undefined Authorization header', async () => {
    const tm = makeTokenManager({ 'vtk_abc123': { botName: 'alice' } });
    const req = { headers: {} };
    const result = await validateToken(req, tm);
    expect(result).toBeNull();
  });

  it('returns null for non-vtk_ token', async () => {
    const tm = makeTokenManager({ 'sk-ant-xxx': { botName: 'alice' } });
    const result = await validateToken(makeReq('Bearer sk-ant-xxx'), tm);
    expect(result).toBeNull();
  });

  it('returns null for token not in store', async () => {
    const tm = makeTokenManager({});
    const result = await validateToken(makeReq('Bearer vtk_notinstore'), tm);
    expect(result).toBeNull();
  });

  it('returns null for token with missing botName in store', async () => {
    const tm = makeTokenManager({ 'vtk_abc123': {} });
    const result = await validateToken(makeReq('Bearer vtk_abc123'), tm);
    expect(result).toBeNull();
  });

  it('returns null when tokenManager.read() throws', async () => {
    const tm = { async read() { throw new Error('disk failure'); } };
    const result = await validateToken(makeReq('Bearer vtk_abc123'), tm);
    expect(result).toBeNull();
  });

  it('requires "Bearer " prefix', async () => {
    const tm = makeTokenManager({ 'vtk_abc123': { botName: 'alice' } });
    // Token without "Bearer " prefix
    const result = await validateToken(makeReq('vtk_abc123'), tm);
    expect(result).toBeNull();
  });

  it('is case-sensitive for the token value', async () => {
    const tm = makeTokenManager({ 'vtk_ABC123': { botName: 'alice' } });
    const result = await validateToken(makeReq('Bearer vtk_abc123'), tm);
    expect(result).toBeNull();
  });
});

// ─── requireSecret ────────────────────────────────────────────────────────────

function makeExpressContext(authHeader) {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; },
  };
  const req = { headers: { authorization: authHeader || '' } };
  return { req, res };
}

describe('requireSecret', () => {
  it('calls next() for valid bearer secret', () => {
    const middleware = requireSecret('my-secret');
    const { req, res } = makeExpressContext('Bearer my-secret');
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res._status).toBeNull();
  });

  it('returns 401 for wrong secret', () => {
    const middleware = requireSecret('my-secret');
    const { req, res } = makeExpressContext('Bearer wrong-secret');
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 for missing Authorization header', () => {
    const middleware = requireSecret('my-secret');
    const { req, res } = makeExpressContext('');
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
  });

  it('returns 401 for empty secret (falsy secret always rejects)', () => {
    const middleware = requireSecret('');
    const { req, res } = makeExpressContext('Bearer ');
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
  });

  it('is case-sensitive', () => {
    const middleware = requireSecret('MySecret');
    const { req, res } = makeExpressContext('Bearer mysecret');
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
  });

  it('requires "Bearer " prefix', () => {
    const middleware = requireSecret('my-secret');
    const { req, res } = makeExpressContext('my-secret');
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
  });
});
