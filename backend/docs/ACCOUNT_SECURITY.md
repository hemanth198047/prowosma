# Account security: two-factor login, backup codes, client addresses

This covers the sign-in hardening added after the tenant-isolation work. Code is in
`backend/.../auth/` (pure logic, unit-tested), with Spring wiring in `AuthService`,
`SecurityController`, `JwtUtil`, `ClientIpResolver` and the two filters.

## Two-factor login

Accounts with 2FA turned on now sign in in two steps. Before this, 2FA could be switched on but login only ever
checked the password.

1. `POST /api/auth/login` with email and password. For a 2FA account the reply is **not a session**:
   ```json
   { "requiresTwoFactor": true, "twoFactorToken": "<challenge>" }
   ```
   There is no `token` field. The challenge is a signed token valid for 5 minutes. It proves the password step
   happened and nothing else: every access-token check rejects it (`JwtUtil.isValid` refuses tokens carrying a
   `purpose` claim), so it can't be used as a session.
2. `POST /api/auth/login/2fa` with `{ "twoFactorToken": "...", "code": "123456" }`. `code` is a 6-digit code from
   the authenticator app or an unused backup code. Success returns the normal login response (`token`, `id`, ...).

Accounts without 2FA are unchanged: one step. The web app and the mobile app both handle the second step.
The password-expired reset flow also lands on it for 2FA accounts.

| Situation | Response |
|---|---|
| Wrong or malformed code | 401 `Invalid verification code` (counts as a failure) |
| Code already used (replay) | 401, same message |
| Challenge expired, forged, or an access token | 401 `This sign-in has expired. Please log in again.` |
| 5 wrong codes | 429 `Too many incorrect codes. Try again in N minutes.` for 15 minutes |

**Replay.** RFC 6238 says a one-time password must not be accepted twice. The account remembers the last accepted
30-second step and refuses any code from that step or earlier.

**Lockout.** The count and the lock are per account, not per address, so they hold however the attacker's address
changes. The same limit protects the 2FA settings endpoints below (a stolen session could otherwise guess codes
through `/2fa/disable`). A correct code resets the count. The trade-off: someone who knows an account's password can
lock that account's code entry for 15 minutes by failing on purpose. That is preferable to allowing unlimited
guesses at six digits.

## Setting up, replacing and disabling

Endpoints under `/api/security/2fa/`:

- `POST setup`: starts enrolment and returns the secret and QR. The new secret is stored as **pending**; it does not
  affect login until verified. If 2FA is already on, the body must include `{ "code": ... }` (current authenticator
  code or a backup code). Before this, setup overwrote the active secret at once with no proof, so a stolen session
  could substitute its own authenticator.
- `POST verify` `{code}`: checks a code from the *pending* secret, then enables 2FA and returns
  `{ "enabled": true, "backupCodes": [10 codes] }`. **This is the only time the codes are returned.**
  (A setup started before this change, which left its candidate in the old field, still verifies.)
- `POST disable` `{code}`: needs a current code or a backup code. Clears the secret and the backup codes.
- `POST backup-codes` `{code}`: needs a current code or a backup code. Returns ten new codes; the old ones stop working.
- `GET status`: `{ enabled, backupCodesRemaining }`.

## Backup codes

Ten per set, formatted `abcde-fghjk`, from an alphabet without `i l o 0 1`. About 49 bits each. Only SHA-256 hashes are
stored, so nobody (including support) can read them back. A code works once and is then removed. Case, hyphen and
spacing don't matter when typing one. Using one is logged as `LOGIN_2FA_BACKUP_CODE_USED`.

Someone who loses their phone can sign in with a backup code, then set up a new authenticator (another backup code
serves as the proof) and get fresh codes.

Existing 2FA accounts have **no** backup codes until the user regenerates them (the Security tab shows "Backup codes
remaining"). Their authenticator keeps working; if they have already lost it, an admin has to switch 2FA off for them
in the database (`twoFactorEnabled=false`, clear `twoFactorSecret`). There is no admin reset endpoint yet.

## Credentials in responses

`GET /api/auth/profile` and `GET /api/users/me` returned the stored user document, including the password hash, TOTP
secret and its pending/lock state, backup-code hashes, refresh token, magic-link token, email OTP and guest token. The
web app then wrote the whole response into `localStorage` and `sessionStorage`. All of those fields are now
`@JsonIgnore` on `User`, so they can't reach any response, including ones added later. No client code read any of them.
Browsers that stored the old response are cleaned at the next profile refresh (every page load).

## Client address and trusted proxies

Rate limiting (anonymous callers), workspace IP allow-lists and login/audit records all need the caller's address.
`X-Forwarded-For` is written by the caller as much as by any proxy, and all three took its first entry from anyone.

Now (`auth/ClientIp`, wired through `config/ClientIpResolver`):

- If the TCP peer is **not** a trusted proxy, the headers are ignored and the peer address is used.
- If it is, `X-Forwarded-For` is read **from the right**, skipping addresses that are themselves trusted proxies. The
  first other address is the client. Entries a client writes on the left can't override what your proxy appended.
  `X-Real-IP` is used only if there is no usable `X-Forwarded-For`.

**Trusted by default:** loopback and private ranges (`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`,
`::1`, `fc00::/7`), where a proxy normally sits.

### Action required if your proxy is on a public address

If a load balancer or CDN reaches the app from a public address, set `TRUSTED_PROXIES` (comma-separated IPs or CIDR
ranges):

```
TRUSTED_PROXIES=203.0.113.10,198.51.100.0/24
```

Without it the app sees every user as the proxy's address: one shared rate-limit bucket for everyone, and any workspace
IP allow-list rejecting all users. A malformed value stops startup instead of silently changing who is trusted.

To check after deploying: sign in and look at the address in the security activity log; it should be yours, not your
proxy's.

## IP allow-list matching

Entries are now matched by address:

| Entry | Matches |
|---|---|
| `203.0.113.9` | that address only (used to also match `203.0.113.90`) |
| `10.0.0.0/8`, `2001:db8::/32` | anything in the range (CIDR entries never matched before) |
| `10.1.*`, `10.1.`, `10.1` | addresses starting `10.1.` (whole octets only; `1.2` no longer matches `1.20.x.x`) |
| `*` | everything (kept, as it was) |

Anything else matches nothing.

## Not covered here

- **Magic-link, social and SSO sign-in do not ask for a code.** A magic link proves control of the mailbox, and SSO
  providers do their own MFA, but an account with 2FA can still be entered by someone who controls its email.
  Requiring the code there is the natural next step.
- The refresh-token flow and existing sessions are unaffected: turning on 2FA does not sign out current sessions.
- Plain password login has no per-account lockout, only the rate limit, which is now per real client address.
- `application.properties` still has a published development default for `jwt.secret`. `prod` and `staging` require
  `JWT_SECRET` (startup fails without it), but a deployment run with no profile would use the public default.
- `IpAllowlistFilter` only applies when the request carries `X-Workspace-Id`.

## Verification

- `auth/` unit tests (33): TOTP against the RFC 4226 and RFC 6238 published vectors, backup codes, lockout, IP ranges and
  client-address resolution. Mutation-tested: every behaviour was broken on purpose and a test failed (the two
  survivors are equivalent mutants: early rejections that later comparison would reject anyway).
- Integration tests (need the Spring/Mongo test setup): `TwoFactorLoginTest`, `TwoFactorSetupTest`,
  `UserSecretsNotExposedTest`, `ClientIpRateLimitTest`.
- Frontend: `Login.twoFactor`, `BackupCodesPanel`, `ProfileSettings.twoFactor` tests.
