//----------------------------------------------------------------------------
//
// aeschat - serverless, browser-to-browser encrypted chat
// https://github.com/ronaegis/aeschat
//
// There is no chat server. Browsers in the same room find each other through
// public relays (encrypted handshake only) and then talk directly over WebRTC.
// Every message is also encrypted with a key derived from the room name.
//
//----------------------------------------------------------------------------

(function () {
  'use strict';

  // Namespace on the public relays. Everyone must use the same value.
  var APP_ID = 'aeschat';

  // Number of chat lines a peer hands over to someone who just joined
  var HISTORY_LINES = 32;

  // Fixed bcrypt salt (kept from the original aeschat)
  var BCRYPT_SALT = '$2a$10$0gP52fjilt.yQTzi0uY8xu';

  // Optional override of the signaling relays, e.g. ['wss://my.relay']
  var RELAY_URLS = window.AESCHAT_RELAYS || null;

  var enc = new TextEncoder();
  var dec = new TextDecoder();

  var user = '';
  var room = null;      // Trystero room
  var aesKey = null;    // AES-256-GCM key for chat payloads
  var session = 0;      // bumps on every login/logout, cancels stale callbacks
  var lines = [];       // chat lines {id, t, u, m}, oldest first
  var seen = {};        // line ids already displayed
  var names = {};       // peerId -> username
  var gotHistory = false;
  var actMsg, actHello, actHist;

  function el(id) { return document.getElementById(id); }

  //--------------------------------------------------------------------------
  // Crypto

  function toHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++)
      s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  function sha256(str) {
    return crypto.subtle.digest('SHA-256', enc.encode(str)).then(function (d) {
      return new Uint8Array(d);
    });
  }

  function bcryptHash(str) {
    return new Promise(function (resolve, reject) {
      try {
        new bCrypt().hashpw(str, BCRYPT_SALT, resolve, function () {});
      } catch (e) { reject(e); }
    });
  }

  // room name -> {chan, password, key}
  //   chan:     public-ish room id used to find peers
  //   password: encrypts the WebRTC handshake on the relays
  //   key:      encrypts chat payloads
  async function deriveRoom(roomName) {
    var bh = await bcryptHash(roomName + 'AESchat!');
    var chan = toHex(await sha256(bh));
    var password = toHex(await sha256(bh + chan + 'signal'));
    var raw = await sha256(bh + chan);
    var key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false,
      ['encrypt', 'decrypt']);
    return { chan: chan, password: password, key: key };
  }

  // JSON value -> iv(12) || AES-GCM ciphertext
  async function seal(obj) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv }, aesKey, enc.encode(JSON.stringify(obj))));
    var out = new Uint8Array(12 + ct.length);
    out.set(iv, 0);
    out.set(ct, 12);
    return out;
  }

  async function unseal(data) {
    var u8 = data instanceof ArrayBuffer ? new Uint8Array(data) :
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    var pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: u8.slice(0, 12) }, aesKey, u8.slice(12));
    return JSON.parse(dec.decode(pt));
  }

  function randomId() {
    return toHex(crypto.getRandomValues(new Uint8Array(12)));
  }

  //--------------------------------------------------------------------------
  // Display

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Text -> DOM nodes: links become anchors, the rest gets emoticons
  function renderText(parent, text) {
    var parts = text.split(/(https?:\/\/[^\s]+)/g);
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      if (i % 2) {
        var a = document.createElement('a');
        a.href = parts[i];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = parts[i];
        parent.appendChild(a);
      } else {
        var span = document.createElement('span');
        span.innerHTML = encodeEmoticons(escapeHtml(parts[i]));
        parent.appendChild(span);
      }
    }
  }

  function appendRow(time, text, cls) {
    var area = el('text_area');
    var row = document.createElement('div');
    if (cls) row.className = cls;
    row.appendChild(document.createTextNode(
      new Date(time).toLocaleTimeString() + '> '));
    renderText(row, text);
    area.appendChild(row);
    area.scrollTop = area.scrollHeight;
  }

  function sysLine(text) { appendRow(Date.now(), text, 'sys'); }

  function validLine(l) {
    return l && typeof l.id === 'string' && l.id.length <= 64 &&
      typeof l.t === 'number' && isFinite(l.t) &&
      typeof l.u === 'string' && l.u.length <= 64 &&
      typeof l.m === 'string' && l.m.length <= 2000;
  }

  // Add chat lines (new or from history), keeping them in time order
  function addLines(incoming) {
    var fresh = incoming.filter(function (l) {
      if (!validLine(l) || seen[l.id]) return false;
      seen[l.id] = true;
      return true;
    });
    if (!fresh.length) return;

    var last = lines.length ? lines[lines.length - 1].t : -Infinity;
    var inOrder = fresh.every(function (l) {
      var ok = l.t >= last;
      last = Math.max(last, l.t);
      return ok;
    });
    lines = lines.concat(fresh);

    if (inOrder) {
      fresh.forEach(function (l) { appendRow(l.t, l.u + ': ' + l.m); });
    } else {
      // Older lines arrived (history): redraw the chat lines in order
      lines.sort(function (a, b) { return a.t - b.t; });
      var area = el('text_area');
      var sys = area.querySelectorAll('.sys');
      area.textContent = '';
      lines.forEach(function (l) { appendRow(l.t, l.u + ': ' + l.m); });
      for (var i = 0; i < sys.length; i++) area.appendChild(sys[i]);
      area.scrollTop = area.scrollHeight;
    }
  }

  function updateStatus() {
    var n = Object.keys(room ? room.getPeers() : {}).length;
    el('status').textContent = n === 0 ?
      'Waiting for someone else to join this room...' :
      'Connected directly to ' + n + (n === 1 ? ' person' : ' people');
  }

  function showError(msg) {
    var box = el('login-error');
    box.textContent = msg;
    box.hidden = false;
  }

  //--------------------------------------------------------------------------
  // Room

  async function doChat() {
    user = el('username').value.trim();
    var roomName = el('room').value;
    if (!user || !roomName) {
      showError("Username and room can't be empty!");
      return;
    }
    el('login-error').hidden = true;
    try { localStorage.setItem('user', user); } catch (e) {}

    var go = el('gobutton');
    go.textContent = 'Computing encryption key, please wait...';
    go.disabled = true;

    var mySession = ++session;
    var derived;
    try {
      derived = await deriveRoom(roomName);
    } catch (e) {
      showError('Could not compute the encryption key: ' + e);
      return;
    } finally {
      go.textContent = 'Go';
      go.disabled = false;
    }
    if (mySession !== session) return;

    aesKey = derived.key;
    lines = [];
    seen = {};
    names = {};
    gotHistory = false;

    el('link').href = '#' + encodeURIComponent(roomName);
    el('logform').hidden = true;
    el('how').hidden = true;
    el('text_area').textContent = '';
    el('chat').hidden = false;
    el('textline').focus();

    var config = {
      appId: APP_ID,
      password: derived.password,
      identity: 'none' // fresh identity every session, nothing kept on disk
    };
    if (RELAY_URLS) config.relayConfig = { urls: RELAY_URLS };

    room = Trystero.joinRoom(config, derived.chan);
    actMsg = room.makeAction('msg');
    actHello = room.makeAction('hello');
    actHist = room.makeAction('hist', { kind: 'request' });

    // Someone sent a chat line
    actMsg.onMessage(async function (data) {
      try { addLines([await unseal(data)]); } catch (e) {}
    });

    // Someone told us their name
    actHello.onMessage(async function (data, ctx) {
      try {
        var o = await unseal(data);
        if (typeof o.u !== 'string' || ctx.peerId in names) return;
        names[ctx.peerId] = o.u.slice(0, 32);
        sysLine(names[ctx.peerId] + ' joined the room!');
      } catch (e) {}
    });

    // Someone who just joined asks for the recent lines
    actHist.onRequest(function () {
      return seal(lines.slice(-HISTORY_LINES));
    });

    room.onPeerJoin(async function (ctx) {
      if (mySession !== session) return;
      updateStatus();
      try {
        await actHello.send(await seal({ u: user }), { target: ctx.peerId });
      } catch (e) {}
      if (gotHistory) return;
      gotHistory = true;
      try {
        var reply = await actHist.request(null,
          { target: ctx.peerId, timeoutMs: 10000 });
        var old = await unseal(reply);
        if (mySession === session && Array.isArray(old))
          addLines(old.slice(-HISTORY_LINES));
      } catch (e) {
        gotHistory = false; // try again with the next person
      }
    });

    room.onPeerLeave(function (ctx) {
      if (mySession !== session) return;
      if (names[ctx.peerId]) sysLine(names[ctx.peerId] + ' logged out');
      delete names[ctx.peerId];
      updateStatus();
    });

    room.onError(function (err) {
      if (mySession !== session) return;
      if (err.code === 'peer-connect-failed')
        sysLine('Could not connect directly to someone in this room ' +
          '(a firewall or network is blocking it).');
      else if (err.code === 'relay-failed')
        sysLine('Could not reach the public relays used to find other people.');
    });

    sysLine(user + ' joined the room!');
    updateStatus();
  }

  async function doSend() {
    var input = el('textline');
    var text = input.value;
    if (text === '' || !room) return;
    input.value = '';

    var line = { id: randomId(), t: Date.now(), u: user, m: text };
    addLines([line]);
    try {
      await actMsg.send(await seal(line));
    } catch (e) {
      sysLine('Message could not be sent: ' + e);
    }
  }

  function doLogout() {
    session++;
    if (room) room.leave().catch(function () {});
    room = null;
    aesKey = null;
    lines = [];
    seen = {};
    names = {};
    el('chat').hidden = true;
    el('logform').hidden = false;
    el('how').hidden = false;
    el('text_area').textContent = '';
  }

  //--------------------------------------------------------------------------
  // Page setup

  el('logform').addEventListener('submit', function (e) {
    e.preventDefault();
    doChat();
  });

  el('chatform').addEventListener('submit', function (e) {
    e.preventDefault();
    doSend();
  });

  el('logout').addEventListener('click', doLogout);

  el('aboutlink').addEventListener('click', function (e) {
    e.preventDefault();
    el('about').hidden = !el('about').hidden;
  });

  el('randomroom').addEventListener('click', function () {
    el('room').value = xkcd_pw_gen();
  });

  // Author credit (rot13, as in the original page)
  el('credit').innerHTML =
    '&pbcl; 2014 <n uers="znvygb:nrfpung666@tznvy.pbz" ery="absbyybj">Puevfgbcur Guvonhyg</n>'
      .replace(/[a-zA-Z]/g, function (c) {
        return String.fromCharCode(
          (c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
      });

  // Default username and room: the room comes from the link, or is random
  try {
    var saved = localStorage.getItem('user');
    if (saved) el('username').value = saved;
  } catch (e) {}

  var hash = window.location.hash;
  if (hash.length > 1) {
    try { el('room').value = decodeURIComponent(hash.substring(1)); }
    catch (e) { el('room').value = hash.substring(1); }
  } else {
    el('room').value = xkcd_pw_gen();
  }

  if (!window.isSecureContext || !window.crypto || !crypto.subtle ||
      !window.RTCPeerConnection) {
    showError('This browser cannot run AESchat here: it needs HTTPS and ' +
      'WebRTC (Tor Browser turns WebRTC off).');
    el('gobutton').disabled = true;
  }
})();
