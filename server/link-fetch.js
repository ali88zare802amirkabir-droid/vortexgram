// VORTEXGRAM — public outbound HTTP fetcher with per-hop DNS validation.
//
// Every redirect target is resolved again and connected only through a lookup
// function pinned to one validated address. This closes both ordinary SSRF and
// DNS-rebinding attacks in which a hostname resolves safely once and then to a
// private address on a later hop.
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

function parseIPv4(input) {
  const parts = String(input || '').split('.');
  if (parts.length !== 4) return null;
  const octets = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isPrivateIPv4Address(octets) {
  const [a, b, c] = octets;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && ((b === 18 || b === 19) || (b === 51 && c === 100))) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function parseHexGroup(group) {
  if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
  return parseInt(group, 16);
}

function parseIPv6Words(input) {
  const address = String(input || '');
  if (address.includes('%')) return { scope: true };
  if (address.indexOf('::') !== address.lastIndexOf('::')) return null;

  let headText = address;
  let tailText = null;
  const compression = address.indexOf('::');
  if (compression !== -1) {
    headText = address.slice(0, compression);
    tailText = address.slice(compression + 2);
  }
  const head = headText ? headText.split(':') : [];
  const tail = tailText === null ? null : (tailText ? tailText.split(':') : []);
  const words = [];

  const pushGroup = (group, mustBeLast, dottedAllowed) => {
    if (group.includes('.')) {
      if (!mustBeLast || !dottedAllowed) return false;
      const octets = parseIPv4(group);
      if (!octets) return false;
      words.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      return true;
    }
    const value = parseHexGroup(group);
    if (value === null) return false;
    words.push(value);
    return true;
  };

  for (let i = 0; i < head.length; i++) {
    const last = tailText === null && i === head.length - 1;
    if (!pushGroup(head[i], last, true)) return null;
  }
  if (tailText !== null) {
    // An embedded dotted quad consumes two 16-bit words, but tail.length counts it once.
    const dottedTail = tail.length && tail[tail.length - 1].includes('.') ? 1 : 0;
    const need = 8 - words.length - (tail.length + dottedTail);
    if (need < 1) return null;
    for (let i = 0; i < need; i++) words.push(0);
    for (let i = 0; i < tail.length; i++) {
      if (!pushGroup(tail[i], i === tail.length - 1, true)) return null;
    }
  }
  if (words.length !== 8) return null;
  return { scope: false, words };
}

function isPrivateIPv6Address(words) {
  const [w0, w1] = words;
  if (words.every((word) => word === 0)) return true;
  if (w0 === 0 && w1 === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && ((words[5] === 0 && words[6] === 0 && words[7] === 1) || words[5] === 0xffff)) {
    if (words[5] === 0xffff) {
      const octets = [(words[6] >> 8) & 0xff, words[6] & 0xff, (words[7] >> 8) & 0xff, words[7] & 0xff];
      return isPrivateIPv4Address(octets);
    }
    return true;
  }
  if ((w0 & 0xffc0) === 0xfe80) return true;
  if ((w0 & 0xfe00) === 0xfc00) return true;
  if ((w0 & 0xff00) === 0xff00) return true;
  if (w0 === 0x2001 && w1 === 0x0db8) return true;
  if (w0 === 0x2001 && w1 === 0x0002) return true;
  if (w0 === 0x2001 && w1 === 0x0000) return true;
  if (w0 === 0x2002) {
    return isPrivateIPv4Address([(words[1] >> 8) & 0xff, words[1] & 0xff, (words[2] >> 8) & 0xff, words[2] & 0xff]);
  }
  if ((w0 & 0xe000) !== 0x2000) return true;
  return false;
}

function isPrivateIp(ip) {
  if (typeof ip !== 'string' || !ip) return true;
  if (!ip.includes(':')) {
    const octets = parseIPv4(ip);
    if (!octets) return true;
    return isPrivateIPv4Address(octets);
  }
  const parsed = parseIPv6Words(ip.toLowerCase());
  if (!parsed || parsed.scope) return true;
  return isPrivateIPv6Address(parsed.words);
}

function isPublicIpAddress(ip) {
  return !isPrivateIp(ip);
}

async function lookupPublicAddresses(hostname, lookup = dns.promises.lookup) {
  const records = await lookup(hostname, { all: true });
  const addresses = [...new Set((records || []).map((record) => (typeof record === 'string' ? record : record && record.address)).filter(Boolean))];
  if (!addresses.length) throw new Error('DNS lookup returned no addresses');
  const blocked = addresses.filter((address) => isPrivateIp(address));
  if (blocked.length) throw new Error('destination IP not allowed');
  return addresses;
}

function pinnedLookup(addresses) {
  const address = String(addresses[0]);
  const family = address.includes(':') ? 6 : 4;
  return function lookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    callback(null, address, family);
  };
}

function startRequest(url, options = {}) {
  const transport = String(url).startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.get(url, options, resolve);
    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
      reject(new Error('timeout'));
    });
    request.on('error', reject);
  });
}

async function fetchPublicUrl(startUrl, options = {}) {
  const {
    maxRedirects = 3,
    timeoutMs = 3000,
    headers = {},
    lookup = dns.promises.lookup,
    request = startRequest,
  } = options;
  let url = String(startUrl || '');
  for (let hops = 0; hops <= maxRedirects; hops++) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('bad request url');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad request protocol');
    const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
    if (!ALLOWED_PORTS.has(port)) throw new Error('bad request port');
    const addresses = await lookupPublicAddresses(parsed.hostname, lookup);
    const response = await request(url, { headers, timeout: timeoutMs, timeoutMs, lookup: pinnedLookup(addresses) });
    const location = response && response.headers ? response.headers.location : null;
    if (REDIRECT_STATUSES.has(response.statusCode) && location && hops < maxRedirects) {
      try {
        if (typeof response.resume === 'function') response.resume();
      } catch {}
      url = new URL(location, url).href;
      continue;
    }
    if (REDIRECT_STATUSES.has(response.statusCode) && location) throw new Error('too many redirects');
    response.finalUrl = url;
    return response;
  }
  throw new Error('too many redirects');
}

module.exports = {
  ALLOWED_PORTS,
  REDIRECT_STATUSES,
  isPrivateIp,
  isPublicIpAddress,
  lookupPublicAddresses,
  pinnedLookup,
  startRequest,
  fetchPublicUrl,
};
