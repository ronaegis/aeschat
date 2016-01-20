aeschat
=======

Simple and secure encrypted chat in JavaScript

Live demo at [https://aeschat.com/](https://aeschat.com/)

Features
========

- Fast and easy way to securely chat
- End-to-end encryption done in the browser
- Uses [bcrypt](http://en.wikipedia.org/wiki/Bcrypt), [SHA256](http://en.wikipedia.org/wiki/SHA-2) and [AES](http://en.wikipedia.org/wiki/Advanced_Encryption_Standard)
- Encryption key derived from the room name using bcrypt
- No message stored on the server
- Easy to generate link addresses for other people to join

Requirements
============

- [Node.js](https://nodejs.org/)

Project Layout
==============

- [web](web) - Static HTML files served by the server.js script
- [server.js](server.js) - Node.js server script to run

Run
===

- Install Node.js
- Launch server with `node server.js`
- Browse to http://localhost:8888/
- The server is bound to the localhost interface by default. Modify the `server.js` setting to enable other interfaces
- You can also use nginx or an Apache reverse proxy to provide the service to an outside interface or to have it delivered via SSL

License
=======

BSD. Copyright (c) Christophe Thibault
