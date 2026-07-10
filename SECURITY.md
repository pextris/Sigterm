# SIGTERM — Security Policy

## The Promise

Your work is yours. Your score is yours. Your handle is yours. The grid protects what you earned. That is not a feature. That is a promise.

---

## Reporting a Vulnerability

If you find a security vulnerability do not open a public issue.

Contact pextris directly via Discord: discord.gg/DUnGQkhfu

Include:
- What you found
- How to reproduce it
- What you think the impact is

We will respond within 48 hours. We will fix it before disclosing it publicly. We will credit you in the patch notes if you want credit.

We do not have a bug bounty program yet. We have gratitude and an Archive entry with your name on it.

---

## What We Protect

### Player Accounts
- Passwords are hashed with bcrypt. Never stored in plain text. Never transmitted in plain text.
- Passwords never leave the node they were created on. Ever.
- JWT tokens expire. Sessions are not permanent.
- Login attempts are rate limited. Accounts lock after repeated failures.
- Your handle is yours. Impersonation is grounds for permanent removal.

### Node Integrity
- Every community node receives a signed authentication token from the mothership.
- Leaderboard submissions are cryptographically signed. Fake scores cannot be injected.
- Nodes that behave maliciously are flagged and disconnected from the network.
- The mothership never sends raw player data to community nodes. Ever.
- Community nodes cannot access each other's databases. Ever.

### The Economy
- Credits and GRT are server-side only. Clients cannot modify balances.
- All economy transactions are logged.
- The Public Vault is transparent. Every transaction is visible to all runners.
- There is no path from real money to in-game currency. This closes the most common attack vector in game economies.

### The Sysop
- The Sysop of a node is determined at install time and stored server-side.
- Sysop status cannot be claimed by a player. It is assigned by the node operator.
- The mothership Sysop is pextris. This is hardcoded and cannot be spoofed.

---

## Current Security Status

### Implemented
- bcrypt password hashing
- JWT authentication
- CORS protection
- Environment variable secrets (never in code)

### In Progress — v1.3
- Login rate limiting
- Account lockout after failed attempts
- Password strength requirements
- JWT token expiration and refresh
- HTTPS enforcement

### Planned — v1.4
- Node authentication tokens
- Signed leaderboard submissions
- Node reputation system
- Cross-node request verification

### Planned — v1.6
- Multi-factor authentication
- Account recovery
- Full third party security audit before public launch

---

## What Community Node Sysops Are Responsible For

If you run a community node you are responsible for:

- Keeping your server software updated
- Securing your server against unauthorized access
- Protecting your node's database
- Not sharing player data with third parties
- Complying with applicable privacy laws in your jurisdiction

The mothership is not responsible for security failures on community nodes.

---

## The Hard Rules

These are not guidelines. These are rules that will never change.

1. Passwords never leave the node they were created on. Never.
2. Raw player data never leaves the node it was created on. Never.
3. The mothership never stores payment information. Ever.
4. GRT and credits cannot be manipulated client-side. Ever.
5. No backdoors. No master passwords. No exceptions.

---

## Transparency

Security patches are announced in the Dead Drop and in GitHub releases.

We will always tell the community when something was fixed and what it affected. We will not tell them how to exploit the unpatched version.

The grid is transparent. So are we.

---

// your work is yours.
// your score is yours.  
// your handle is yours.
// the grid protects what you earned.
// discord.gg/DUnGQkhfu
// github.com/pextris/Sigterm
