/**
 * LingoBlend — browser-side plugin for CrossPoint's File Transfer web UI.
 *
 * The device can download books on its own (device.json), but it cannot send
 * anything back: clippings are not in the firmware's event whitelist, and
 * CrossPoint never runs the network while a book is open. So the "save a word"
 * loop closes here — you plug the reader in, open File Transfer, and press Sync.
 *
 * What it does:
 *   - shows sign-in state from the shared token file, and can sign in or out
 *   - reads /My Clippings.txt, works out what is new, and uploads only that
 *   - reports what happened in plain counts
 *
 * Three things worth knowing before changing it:
 *
 *  1. **Only the new tail is sent.** The file is append-only and can reach
 *     megabytes; re-uploading it every time would be slow over the device's
 *     2.4 GHz WiFi and would re-do work the server already did. The resume
 *     point is a byte offset plus a hash of the first 512 bytes — if the head
 *     changed, the file was deleted or replaced, so we rescan from zero.
 *  2. **`fetch` first, `api.relay` second.** The browser verifies our
 *     certificate; the device's HTTP client does not verify ANY certificate.
 *     Sending a user's clippings through the unverified path when the browser
 *     could do it properly would be a downgrade, so the relay is only a
 *     fallback for when the browser cannot reach us directly.
 *  3. **Clipped text is never rendered into this page.** It is the user's own
 *     reading, it passes through here on its way to their account, and putting
 *     it in the DOM of an unauthenticated LAN web UI would be a gratuitous
 *     exposure. Only counts are shown.
 */

/* global CrossPoint */

(() => {
  const API = 'https://www.lingoblend.app/reader-api';
  const TOKEN_FILE = '/.crosspoint/lingoblend.json';
  const CLIPPINGS_FILE = '/My Clippings.txt';
  /**
   * ⚠️ NOT under `/.crosspoint/plugins/` — THAT DIRECTORY IS A PLUGIN ROOT.
   *
   * `PluginLocations::ROOTS` is
   * `{"/.crosspoint/plugins", "/plugins", "/.plugins"}`, scanned in order, and
   * `scanPlugins()` claims a folder name into `seen` BEFORE testing for marker
   * files. So writing state to `/.crosspoint/plugins/lingoblend/state.json`
   * created a folder that claimed the name "lingoblend" and then failed the
   * marker test — and the REAL plugin in `/plugins/lingoblend` was skipped as
   * a duplicate. The plugin disappeared from Settings → System → Plugins the
   * first time a sync succeeded, with nothing to see on the card: every file
   * was present and correct.
   *
   * Beside the token file instead, which has always been safe.
   */
  const STATE_FILE = '/.crosspoint/lingoblend-state.json';

  /** Server cap per request. The file is sent in chunks this size. */
  const BATCH_BYTES = 120 * 1024;
  /** Bytes of the file head that identify it, so a replaced file is noticed. */
  const HEAD_BYTES = 512;

  CrossPoint.registerPlugin((container, api) => {
    const el = (tag, props = {}, ...children) => {
      const node = Object.assign(document.createElement(tag), props);
      for (const child of children) node.append(child);
      return node;
    };

    const status = el('p', { className: 'lb-status' });
    const detail = el('p', { className: 'lb-detail' });
    const signInBtn = el('button', { textContent: 'Sign in' });
    const signOutBtn = el('button', { textContent: 'Sign out', hidden: true });
    const syncBtn = el('button', {
      textContent: 'Sync clippings',
      disabled: true,
    });

    const dictStatus = el('p', { className: 'lb-status' });
    const dictActions = el('div', { className: 'lb-actions' });

    container.append(
      el('h3', { textContent: 'LingoBlend' }),
      status,
      el('div', { className: 'lb-actions' }, signInBtn, signOutBtn, syncBtn),
      detail,
      el('h3', { textContent: 'Dictionary' }),
      dictStatus,
      dictActions
    );

    const say = (text, isDetail = false) => {
      (isDetail ? detail : status).textContent = text;
    };

    // ── Device file helpers ──────────────────────────────────────────────────

    /** Read a file off the SD card through the device's own web server. */
    const readFile = async path => {
      const res = await fetch(`/download?path=${encodeURIComponent(path)}`);
      if (!res.ok) return null;
      return res;
    };

    const readJson = async path => {
      const res = await readFile(path);
      if (!res) return null;
      try {
        return JSON.parse(await res.text());
      } catch {
        return null;
      }
    };

    const writeJson = async (path, value) => {
      const base64 = btoa(unescape(encodeURIComponent(JSON.stringify(value))));
      await api.writeFile(path, base64);
    };

    /**
     * Delete through the device's endpoint.
     * ⚠️ FORM-ENCODED, not JSON — /delete and /mkdir take `path` as a form
     * field. Sending JSON here silently does nothing.
     */
    const deleteFile = async path => {
      await fetch('/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `path=${encodeURIComponent(path)}`,
      });
    };

    // ── Our API ──────────────────────────────────────────────────────────────

    /**
     * POST to LingoBlend. The browser's own fetch is tried first so the TLS
     * certificate is actually verified; api.relay (device-side, unverified) is
     * the fallback for when the browser cannot reach us.
     */
    const post = async (path, body, token) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      try {
        const res = await fetch(`${API}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        return { ok: res.ok, data: await res.json() };
      } catch {
        const relayed = await api.relay(
          'POST',
          `${API}${path}`,
          headers,
          JSON.stringify(body)
        );
        try {
          return { ok: true, data: JSON.parse(relayed) };
        } catch {
          return { ok: false, data: null };
        }
      }
    };

    // ── Active dictionary ────────────────────────────────────────────────────

    /**
     * Choosing the dictionary is the step everyone forgets, and forgetting it
     * fails SILENTLY: the reader finds nothing for every word and says only
     * "not found", which reads as a broken dictionary rather than an unmade
     * choice. Settings → Reader → Dictionary is three screens away from where
     * the book arrives, so offer it here, where the reader is already open.
     *
     * `dictionaryName` is an ENUM setting whose options are literally the
     * installed folders, "None" first (SettingsList.h buildDictionarySetting),
     * and the value is an INDEX into that list — so GET tells us what is
     * installed and what is active, and POST takes the index.
     */
    const DICT_KEY = 'dictionaryName';

    const readDictSetting = async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return null;
        const all = await res.json();
        const item = (Array.isArray(all) ? all : []).find(
          s => s && s.key === DICT_KEY
        );
        if (!item || !Array.isArray(item.options)) return null;
        return { options: item.options, value: Number(item.value) || 0 };
      } catch {
        return null;
      }
    };

    const setDictSetting = async index => {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [DICT_KEY]: index }),
      });
      return res.ok;
    };

    const refreshDictionary = async () => {
      dictActions.replaceChildren();
      const setting = await readDictSetting();
      if (!setting) {
        dictStatus.textContent =
          'Could not read the reader’s settings. Choose one under Settings, Reader, Dictionary.';
        return;
      }
      const active = setting.options[setting.value] ?? 'None';
      // Index 0 is "None"; ours are the folders starting with our prefix.
      const ours = setting.options
        .map((name, index) => ({ name, index }))
        .filter(o => o.index > 0 && o.name.startsWith('lingoblend-'));

      if (ours.length === 0) {
        dictStatus.textContent =
          'No LingoBlend dictionary on the card yet. Get one from the LingoBlend Dictionaries plugin.';
        return;
      }

      dictStatus.textContent =
        setting.value > 0
          ? `In use: ${active}`
          : 'No dictionary selected — looking a word up will find nothing.';

      for (const o of ours) {
        if (o.index === setting.value) continue;
        const btn = el('button', { textContent: `Use ${o.name}` });
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Selecting…';
          const ok = await setDictSetting(o.index);
          if (ok) {
            dictStatus.textContent = `In use: ${o.name}`;
            await refreshDictionary();
          } else {
            dictStatus.textContent =
              'Could not change it here. Settings, Reader, Dictionary still works.';
            btn.disabled = false;
            btn.textContent = `Use ${o.name}`;
          }
        });
        dictActions.append(btn);
      }
    };

    // ── Sign in / out ────────────────────────────────────────────────────────

    let token = null;

    const refreshSignedIn = async () => {
      const stored = await readJson(TOKEN_FILE);
      token = stored?.token ?? null;
      signInBtn.hidden = !!token;
      signOutBtn.hidden = !token;
      syncBtn.disabled = !token;
      say(
        token
          ? 'Signed in. Clip words while you read, then press Sync.'
          : 'Not signed in.'
      );
    };

    signInBtn.addEventListener('click', async () => {
      signInBtn.disabled = true;
      say('Starting sign-in…');
      const start = await post('/v1/auth/device', {
        client: 'plugin-web',
        v: 1,
      });
      if (!start.ok || !start.data?.device_code) {
        say('Could not start sign-in. Check the reader’s WiFi and try again.');
        signInBtn.disabled = false;
        return;
      }

      const {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: uri,
      } = start.data;
      say(`Open ${uri} and enter ${userCode}`);
      const link = el('a', {
        href: start.data.verification_uri_complete ?? uri,
        target: '_blank',
        rel: 'noopener',
        textContent: 'Open the approval page',
      });
      detail.replaceChildren(link);

      // Poll at the interval the server asked for, until it expires.
      const intervalMs = Math.max(2, Number(start.data.interval) || 5) * 1000;
      const deadline =
        Date.now() + (Number(start.data.expires_in) || 600) * 1000;
      let waitMs = intervalMs;

      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, waitMs));
        const poll = await post('/v1/auth/token', { device_code: deviceCode });
        const error = poll.data?.error;
        if (poll.data?.access_token) {
          await writeJson(TOKEN_FILE, { token: poll.data.access_token });
          detail.replaceChildren();
          await refreshSignedIn();
          signInBtn.disabled = false;
          return;
        }
        // RFC 8628: back off when told to, stop on a terminal error.
        if (error === 'slow_down') waitMs += 2000;
        else if (error && error !== 'authorization_pending') break;
      }

      detail.replaceChildren();
      say('Sign-in expired or was declined. Try again.');
      signInBtn.disabled = false;
    });

    signOutBtn.addEventListener('click', async () => {
      await deleteFile(TOKEN_FILE);
      await refreshSignedIn();
      say('Signed out. The reader keeps the books it already downloaded.');
    });

    // ── Sync ─────────────────────────────────────────────────────────────────

    /**
     * SHA-1 of a byte array, in pure JavaScript.
     *
     * ⚠️ NOT `crypto.subtle`. SubtleCrypto exists ONLY in a secure context,
     * and this page is served over plain HTTP from the reader's LAN address
     * (http://192.168.x.x). There `crypto.subtle` is undefined, so the call
     * threw, the click handler died, and the UI sat on "Reading clippings…"
     * with the button stuck disabled — with no error anywhere, because the
     * throw escaped the handler entirely.
     *
     * The device does expose POST /api/crypto, but hashing here keeps the
     * plugin working on any firmware build and in any context. The input is
     * HEAD_BYTES (512), so the cost is irrelevant.
     *
     * Verified against node's crypto on the standard vectors (including the
     * 55/56/64-byte padding boundaries) and 300 random inputs.
     */
    const sha1Hex = bytes => {
      const ml = bytes.length;
      const buf = new Uint8Array((((ml + 8) >> 6) + 1) << 6);
      buf.set(bytes);
      buf[ml] = 0x80;
      const dv = new DataView(buf.buffer);
      const bits = ml * 8;
      dv.setUint32(buf.length - 8, Math.floor(bits / 0x100000000), false);
      dv.setUint32(buf.length - 4, bits >>> 0, false);

      let h0 = 0x67452301,
        h1 = 0xefcdab89,
        h2 = 0x98badcfe,
        h3 = 0x10325476,
        h4 = 0xc3d2e1f0;
      const w = new Uint32Array(80);
      for (let i = 0; i < buf.length; i += 64) {
        for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
        for (let j = 16; j < 80; j++) {
          const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
          w[j] = ((n << 1) | (n >>> 31)) >>> 0;
        }
        let a = h0,
          b = h1,
          c = h2,
          d = h3,
          e = h4;
        for (let j = 0; j < 80; j++) {
          let f, k;
          if (j < 20) {
            f = (b & c) | (~b & d);
            k = 0x5a827999;
          } else if (j < 40) {
            f = b ^ c ^ d;
            k = 0x6ed9eba1;
          } else if (j < 60) {
            f = (b & c) | (b & d) | (c & d);
            k = 0x8f1bbcdc;
          } else {
            f = b ^ c ^ d;
            k = 0xca62c1d6;
          }
          const t =
            ((((a << 5) | (a >>> 27)) >>> 0) + (f >>> 0) + e + k + w[j]) >>> 0;
          e = d;
          d = c;
          c = ((b << 30) | (b >>> 2)) >>> 0;
          b = a;
          a = t;
        }
        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
      }
      return [h0, h1, h2, h3, h4]
        .map(h => h.toString(16).padStart(8, '0'))
        .join('');
    };

    syncBtn.addEventListener('click', async () => {
      // ⚠️ EVERY path below re-enables the button. An unhandled throw in here
      // is invisible — the page shows whatever `say()` said last and the
      // button stays disabled forever, which is exactly how a missing
      // crypto.subtle presented: a permanent "Reading clippings…".
      try {
        await runSync();
      } catch (err) {
        say('Sync failed. Please try again.');
        say(String((err && err.message) || err), true);
      } finally {
        syncBtn.disabled = false;
      }
    });

    const runSync = async () => {
      syncBtn.disabled = true;
      say('Reading clippings…');
      detail.textContent = '';

      const res = await readFile(CLIPPINGS_FILE);
      if (!res) {
        say(
          'No clippings yet. Press and hold a word while reading, then Clip.'
        );
        return;
      }

      const whole = new Uint8Array(await res.arrayBuffer());
      const headHash = sha1Hex(whole.slice(0, HEAD_BYTES));
      const state = (await readJson(STATE_FILE)) ?? {};

      // A changed head, or a file that shrank, means this is not the file we
      // were reading last time — deleted and recreated, most likely. Rescan
      // from the start; the server deduplicates by content, so nothing is
      // saved twice.
      let offset = Number(state.offset) || 0;
      if (state.headSha1 !== headHash || offset > whole.length) offset = 0;

      const totals = {
        saved: 0,
        duplicate: 0,
        translated: 0,
        passage: 0,
        unknown_book: 0,
        wrong_pair: 0,
        unparsed: 0,
      };

      while (offset < whole.length) {
        const chunk = whole.slice(offset, offset + BATCH_BYTES);
        let binary = '';
        for (const byte of chunk) binary += String.fromCharCode(byte);

        say(`Uploading… ${Math.round((offset / whole.length) * 100)}%`);
        const out = await post(
          '/v1/clippings',
          { v: 1, offset, headSha1: headHash, data: btoa(binary) },
          token
        );
        if (!out.ok || !out.data) {
          say('Sync failed. Check the reader’s WiFi and try again.');
          return;
        }

        for (const key of Object.keys(totals))
          totals[key] += out.data[key] ?? 0;

        // The server reports where IT stopped, which is the end of the last
        // COMPLETE record — a half-written one is left for next time.
        const next = Number(out.data.nextOffset);
        if (!Number.isFinite(next) || next <= offset) break;
        offset = next;
        await writeJson(STATE_FILE, {
          offset,
          headSha1: headHash,
          len: whole.length,
        });
      }

      await writeJson(STATE_FILE, {
        offset,
        headSha1: headHash,
        len: whole.length,
      });

      // Counts only — never the words themselves.
      const parts = [
        `Saved ${totals.saved} word${totals.saved === 1 ? '' : 's'}`,
      ];
      if (totals.duplicate) parts.push(`${totals.duplicate} already saved`);
      if (totals.passage)
        parts.push(
          `${totals.passage} passage${totals.passage === 1 ? '' : 's'} skipped`
        );
      if (totals.unknown_book)
        parts.push(`${totals.unknown_book} from an unknown book`);
      if (totals.wrong_pair)
        parts.push(`${totals.wrong_pair} in another language`);
      say(parts.join(' · '));
      say('They are in your LingoBlend dictionary and practice now.', true);
    };

    // Also expose Sync to the device's job queue, so a future in-app trigger
    // can run it without anyone opening this page.
    api.registerAction('sync', () => syncBtn.click());

    refreshSignedIn();
    // Independent of sign-in: the dictionary lives on the card, so this is
    // worth showing even to someone who has not paired yet.
    refreshDictionary();
  });
})();
