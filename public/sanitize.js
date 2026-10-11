// VORTEXGRAM - shared text/link sanitizer (browser + Node, no dependencies).
//
// This module intentionally avoids document/DOM APIs so the same validation can
// run in the browser renderer, the bot ingest path, and Node regression tests.
(function (root, factory) {
  if (typeof module === 'object' && module !== null && module.exports) module.exports = factory();
  else root.VXSanitize = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const LINK_START = String.fromCharCode(57344);
  const LINK_END = String.fromCharCode(57345);
  const MAX_LINK_LENGTH = 2048;
  const BIDI_CONTROL_CODES = [8234, 8235, 8236, 8237, 8238, 8239, 8294, 8295, 8296, 8297, 8298, 65279];

  function escText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
  }

  function escAttr(value) {
    return escText(value);
  }

  function sanitizeIconName(name) {
    return String(name ?? '').replace(/[^a-z0-9-]/gi, '');
  }

  function hasUnsafeUrlCharacter(value) {
    for (const character of String(value)) {
      const code = character.codePointAt(0);
      if (code <= 32 || code === 127 || code === 57344 || code === 57345) return true;
      if (character === '<' || character === '>' || character === '"' || character === "'" || character === '`' || character === '\\') return true;
      if (BIDI_CONTROL_CODES.indexOf(code) !== -1) return true;
    }
    return false;
  }

  function normalizeRelativeLink(input) {
    // Preserve valid escapes and URL delimiters exactly; only percent-encode
    // characters that cannot appear literally in a URL.
    return Array.from(input).map((character) => (/[A-Za-z0-9\-_.~:/?#[\]@!$&'()*+,;=%]/.test(character) ? character : encodeURIComponent(character))).join('');
  }

  function sanitizeLinkHref(raw) {
    const input = String(raw ?? '').trim();
    if (!input || input.length > MAX_LINK_LENGTH) return null;
    if (hasUnsafeUrlCharacter(input)) return null;
    if (input.startsWith('/')) {
      if (input.startsWith('//') || input.startsWith('/\\')) return null;
      return normalizeRelativeLink(input);
    }
    let parsed;
    try {
      parsed = new URL(input);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.hostname.includes('%')) return null;
    const href = parsed.href;
    if (hasUnsafeUrlCharacter(href)) return null;
    return href;
  }

  function stripUnsafeTextControls(value) {
    return Array.from(String(value ?? '')).filter((character) => {
      const code = character.codePointAt(0);
      if (code === 9 || code === 10) return true;
      if (code <= 31 || code === 127) return false;
      return code !== 57344 && code !== 57345;
    }).join('').replace(/\r\n?/g, '\n');
  }

  function formatText(input) {
    const source = stripUnsafeTextControls(input);
    if (!source) return '';
    const links = [];
    const withPlaceholders = source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text, url) => {
      const safe = sanitizeLinkHref(url);
      if (!safe) return match;
      links.push({ text: escText(text), href: safe });
      return `${LINK_START}${links.length - 1}${LINK_END}`;
    });
    let html = escText(withPlaceholders);
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
    html = html.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    html = html.replace(/\n/g, '<br>');
    const tokenPattern = new RegExp(`${LINK_START}(\\d+)${LINK_END}`, 'g');
    return html.replace(tokenPattern, (match, id) => {
      const link = links[Number(id)];
      if (!link) return '';
      return `<a href="${escAttr(link.href)}" target="_blank" rel="noopener noreferrer nofollow ugc">${link.text}</a>`;
    });
  }

  return { escText, escAttr, sanitizeIconName, sanitizeLinkHref, formatText };
}));
