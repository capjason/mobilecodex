import { isIP } from 'node:net';

const defaultAllowedCidrs = [
  '127.0.0.0/8',
  '::1/128',
  '100.64.0.0/10',
  'fd7a:115c:a1e0::/48'
];

export function allowedCidrsFromEnv(value = process.env.MOBILECODEX_ALLOWED_CIDRS) {
  const raw = String(value || '').trim();
  if (!raw) return defaultAllowedCidrs;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

export function isRequestAllowed(req, cidrs = allowedCidrsFromEnv()) {
  return isIpAllowed(clientAddress(req), cidrs);
}

export function rejectUpgrade(socket) {
  try {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  } finally {
    socket.destroy();
  }
}

export function clientAddress(req) {
  return normalizeIp(req?.socket?.remoteAddress || '');
}

export function isIpAllowed(ip, cidrs = defaultAllowedCidrs) {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return false;
  if (cidrs.includes('*') || cidrs.includes('all')) return true;

  return cidrs.some((cidr) => ipInCidr(normalizedIp, cidr));
}

function ipInCidr(ip, cidr) {
  const [rangeIp, prefixText] = String(cidr || '').split('/');
  const normalizedRange = normalizeIp(rangeIp);
  if (!normalizedRange) return false;

  const ipVersion = isIP(ip);
  const rangeVersion = isIP(normalizedRange);
  if (!ipVersion || ipVersion !== rangeVersion) return false;

  const bits = ipVersion === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return false;

  const ipValue = ipToBigInt(ip, ipVersion);
  const rangeValue = ipToBigInt(normalizedRange, rangeVersion);
  const shift = BigInt(bits - prefix);
  return (ipValue >> shift) === (rangeValue >> shift);
}

function normalizeIp(value) {
  let ip = String(value || '').trim();
  if (!ip) return '';
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  if (ip.startsWith('::ffff:')) ip = ip.slice('::ffff:'.length);
  if (isIP(ip)) return ip;
  return '';
}

function ipToBigInt(ip, version) {
  if (version === 4) {
    return ip.split('.').reduce((value, part) => (value << 8n) + BigInt(Number(part)), 0n);
  }

  const parts = expandIpv6(ip);
  return parts.reduce((value, part) => (value << 16n) + BigInt(parseInt(part, 16)), 0n);
}

function expandIpv6(ip) {
  const [headText, tailText = ''] = ip.split('::');
  const head = headText ? headText.split(':') : [];
  const tail = tailText ? tailText.split(':') : [];
  const missing = 8 - head.length - tail.length;
  return [...head, ...Array(Math.max(missing, 0)).fill('0'), ...tail].map((part) => part || '0');
}
