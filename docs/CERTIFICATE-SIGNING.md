# Certificate signing — verification by employers with no sign-in

An employer who scans the QR code on a CESTIS certificate should be able to
confirm it is genuine on their own phone, without the Centre's Google login and
without seeing anything about the trainee beyond what the certificate states.
This costs nothing to run: it is plain cryptography in the browser, and the
only thing published is a small public file in this repository.

## How it works

* An administrator's device holds the Centre's **private signing key**
  (ECDSA P-256, made with the browser's own WebCrypto). It lives in its own
  IndexedDB database (`CESTIS_CertSigning`), outside the app's data store, so
  no backup, snapshot, Drive sync or LAN sync can ever carry it anywhere.
* When a download is approved on that device (or when **Sign approved
  certificates** is pressed), the certificate's number, holder's name,
  programme (as printed on page 1) and date are signed. The signature is kept
  on the trainee's record (`certSig`) and syncs like everything else.
* The certificate's QR code then carries those four details and the
  signature. The verify door of the portal checks the signature in the
  employer's browser against the **public keys in `cert-keys.json`**. A
  changed letter in any detail breaks the signature ("Not Verified — Details
  Do Not Match").
* A signature cannot be taken back, so withdrawn certificates that were signed
  are published in the same file (`"revoked"`). The verify page reports them
  as **Certificate Revoked**.
* Certificates issued before signing began (and any certificate whose details
  changed after it was signed) keep the old QR code and the old behaviour:
  the portal looks the number up in the Centre's records.

## One-time setup (the Centre)

1. On the administrator's own computer, open **Certificate Downloads →
   Certificate Signing** and press **Create signing key**.
2. Press **Back up private key**. Put the downloaded
   `CESTIS-certificate-signing-key-PRIVATE-<id>.json` on a USB stick kept in
   the safe. **Never** email it, put it in Google Drive, or commit it to
   GitHub — anyone holding it can sign certificates in the Centre's name.
   Delete the copy from the Downloads folder once it is on the stick.
3. Press **Download cert-keys.json (public)** and replace `cert-keys.json` at
   the top of this repository with it (commit and push, or upload it on
   GitHub). The panel shows **published** once the website serves it.
4. Press **Sign approved certificates** to sign every certificate already
   approved. Certificates downloaded before this keep their old QR code;
   a trainee who downloads again gets the signed one.

## Day to day

* Approving a download on the signing computer signs it automatically.
  Approving on another computer does not; press **Sign approved
  certificates** on the signing computer afterwards (the panel shows how many
  approved certificates carry a current signature).
* **Withdrawing a certificate** (moving a certified trainee back to In
  Training, Incomplete or Not Yet Competent in Student Progress) records who,
  when and why, keeps the number on record, and switches the download off.
  If the certificate had been signed, press **Download cert-keys.json** again
  and publish it, so employers' browsers learn of the withdrawal.

## A second signing computer, or a replacement

Use **Restore key from backup** with the private-key file from the safe. The
same key then signs on both computers. A computer may instead create its own
key; publish its public key too (the file can list several keys, and every
key listed stays valid for the certificates it signed).

## If the private key is lost or exposed

Create a new key, publish the new `cert-keys.json`, and re-sign. If it was
exposed, remove the old key's entry from `cert-keys.json`: certificates it
signed then fall back to the records lookup, and nothing signed with the stolen
key will verify.

## What `cert-keys.json` holds

```json
{
  "version": 1,
  "keys": [ { "kid": "…", "alg": "ES256", "label": "…", "createdAt": "…",
              "publicJwk": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" } } ],
  "revoked": [ { "no": "WE-2026-1234-KX", "at": "2026-10-20T15:00:00.000Z" } ]
}
```

Only public data. A `d` value in a key entry would be a private key: it must
never appear in this file (tests/cert-signing.test.js fails if it does).
