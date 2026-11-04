# Security policy

Open Loop runs a local HTTP server and a browser extension with access to every page you visit, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Instead, use GitHub's private reporting: go to the repository's **Security** tab and click **Report a vulnerability**.

Include what's affected, how to reproduce it, and the impact you expect. You'll get a reply as soon as possible, and a fix will be coordinated with you before anything is disclosed.

## In scope

- A web page reading, writing or deleting reports through the local API.
- Captured data leaking off the machine.
- Redaction failing to mask passwords, tokens, card numbers or session data in captured URLs, logs or request bodies.
- Typed text being recorded.

## Supported versions

Only the latest commit on `main` is supported.
