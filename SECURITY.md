# Security Policy

## Supported branch

Security fixes are currently expected to land on the active default branch before the first public release.

## Local security posture

- PrepView is local-first. Portfolio state stays on the machine.
- The portfolio database is encrypted at rest.
- Live exchange credentials are stored in app-local secret files with restrictive filesystem permissions.
- The app does not require OS keychain access or an OS login/password prompt during normal startup.
- LAN projection is disabled by default, loopback-only when enabled locally, and requires a user-set bearer passphrase before exposure.

## Report handling

Before the public repository has a dedicated private reporting channel, do not post credential, secret, or local-exposure findings in a public issue.
Use GitHub Security Advisories or an equivalent private contact path once the repository is published.
