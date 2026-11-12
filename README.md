aeschat
=======

Simple and secure encrypted chat in JavaScript, with no server

Live demo at [https://aeschat.com/](https://aeschat.com/)

Features
========

- Fast and easy way to securely chat
- No chat server: messages travel directly from browser to browser over WebRTC
- End-to-end encryption done in the browser
- Uses [bcrypt](http://en.wikipedia.org/wiki/Bcrypt), [SHA256](http://en.wikipedia.org/wiki/SHA-2) and [AES-GCM](https://en.wikipedia.org/wiki/Galois/Counter_Mode)
- Encryption key derived from the room name using bcrypt
- No message stored anywhere: people joining get the last 32 lines from someone already in the room
- Easy to generate link addresses for other people to join

How it works
============

- The room name is hashed with bcrypt. The result gives a room id, a handshake password and a message key
- Browsers in the same room find each other through public relays, using [Trystero](https://github.com/dmotz/trystero). The relays only see an encrypted connection handshake, never messages
- Once connected, browsers talk directly to each other. Every message is also encrypted with AES-256-GCM using the room key

Good to know
============

- People in the same room can see each other's IP address. This is inherent to direct connections
- Anyone who knows or guesses the room name can join. Use the Random button
- Some restrictive networks block direct connections. There is no relay fallback
- It does not work in Tor Browser, which disables WebRTC

Project Layout
==============

- [web](web) - The whole application, static files only
  - `index.html`, `style.css`, `app.js` - the page and the chat logic
  - `trystero.min.js` - bundled copy of Trystero 0.27.0 (MIT)
  - `bcrypt-min.js`, `xkcd_pw-min.js`, `emo.js`, `emo/` - key derivation, random room names, emoticons

Run
===

- Publish the `web` folder on any static host that serves HTTPS (GitHub Pages, Cloudflare Pages, Netlify, ...)
- To try it locally: `cd web && python3 -m http.server 8888`, then browse to http://localhost:8888/
- To use your own signaling relays instead of the public ones, set `window.AESCHAT_RELAYS = ['wss://...']` in a script loaded before `app.js`

License
=======

BSD. Copyright (c) Christophe Thibault
