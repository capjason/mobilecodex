import assert from 'node:assert/strict';
import test from 'node:test';

import { allowedCidrsFromEnv, clientAddress, isIpAllowed } from '../src/access-control.js';

test('default allowlist permits loopback and Tailscale addresses', () => {
  assert.equal(isIpAllowed('127.0.0.1'), true);
  assert.equal(isIpAllowed('::1'), true);
  assert.equal(isIpAllowed('::ffff:127.0.0.1'), true);
  assert.equal(isIpAllowed('100.64.0.1'), true);
  assert.equal(isIpAllowed('100.127.255.254'), true);
  assert.equal(isIpAllowed('fd7a:115c:a1e0::1'), true);
});

test('default allowlist rejects non-Tailscale client addresses', () => {
  assert.equal(isIpAllowed('100.128.0.1'), false);
  assert.equal(isIpAllowed('192.168.1.20'), false);
  assert.equal(isIpAllowed('10.0.0.5'), false);
  assert.equal(isIpAllowed('8.8.8.8'), false);
  assert.equal(isIpAllowed('2001:4860:4860::8888'), false);
});

test('custom CIDR allowlist is parsed from environment-style text', () => {
  const cidrs = allowedCidrsFromEnv('192.168.0.0/16, 10.0.0.0/8');
  assert.equal(isIpAllowed('192.168.1.20', cidrs), true);
  assert.equal(isIpAllowed('10.1.2.3', cidrs), true);
  assert.equal(isIpAllowed('100.64.0.1', cidrs), false);
});

test('clientAddress normalizes IPv4-mapped socket addresses', () => {
  assert.equal(clientAddress({ socket: { remoteAddress: '::ffff:100.64.0.10' } }), '100.64.0.10');
});
