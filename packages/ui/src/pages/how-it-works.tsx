import { routePath } from '../router.js';

export function HowItWorksPage() {
  return (
    <div>
      <header className="page-head">
        <div className="eyebrow">How It Works</div>
        <h1>Encrypt. Split. Share. Rebuild.</h1>
        <p>What actually happens to your file, step by step.</p>
      </header>

      <div className="prose">
        <h2>1. Encryption comes first</h2>
        <p>
          When you pick a file and a password, HandShack derives a 256-bit encryption key from the
          password using <strong>scrypt</strong> — a memory-hard key-derivation function that makes
          password guessing expensive. A fresh random salt is generated for every package, so two
          packages never share a key, even with the same password.
        </p>
        <p>
          The file is then encrypted with <strong>AES-256-GCM</strong>, an authenticated cipher.
          Authentication matters: it means tampering is detected, not just scrambled. Every 1&nbsp;MB
          "record" of the file is sealed with its own unique nonce and authenticated data that binds
          the package header, the record's position, and whether it is the final record. Reordered,
          duplicated, truncated, or modified records are all rejected.
        </p>

        <h2>2. Then the encrypted package is split</h2>
        <div className="callout">
          <p>
            <strong>Splitting a file does not encrypt it.</strong> HandShack encrypts the file{' '}
            <em>before</em> splitting it — the parts contain only ciphertext. Splitting exists purely
            to make large files easier to share through channels with size limits.
          </p>
        </div>
        <p>
          The encrypted stream is cut into parts at your chosen size (1–4&nbsp;MB). Each part gets a
          deterministic name like <code>photo.jpg.part003.hsp</code> and a SHA-256 fingerprint stored
          in the manifest, so damaged or foreign parts are identified by name before decryption even
          starts.
        </p>

        <h2>3. The manifest describes the package</h2>
        <p>
          A small JSON file — <code>name.hsmanifest.json</code> — records the package ID, part names,
          sizes, hashes, chunk size, and the KDF parameters. It never contains the password or any
          key. The manifest is treated as untrusted input: security-critical values are duplicated
          inside the authenticated package header and cross-checked, so editing the manifest alone
          cannot make HandShack accept a tampered package.
        </p>

        <h2>4. Sharing</h2>
        <p>
          Send the manifest and all parts together through whatever channel you like — email,
          cloud drive, USB stick. <strong>Share the password separately</strong> through a private
          channel (a call, an end-to-end encrypted message). Anyone who obtains the complete package
          and the correct password can recover the file — keep the password private.
        </p>

        <h2>5. Reassembly &amp; decryption</h2>
        <p>
          On the receiving side, HandShack validates the manifest, checks that every part is present
          and intact, reassembles the encrypted stream in order, derives the key from the password,
          and opens each authenticated record. Only if every check passes — including a final
          SHA-256 comparison against the original file's fingerprint recorded at encryption time —
          is the restored file written out. Any failure discards partial output.
        </p>
        <p>
          The result is byte-for-byte identical to the original. A photo stays exactly the same
          photo; nothing is recompressed, resized, or converted.
        </p>

        <h2>Where to go next</h2>
        <ul>
          <li>
            <a href={routePath('encrypt')}>Encrypt &amp; Split a file</a>
          </li>
          <li>
            <a href={routePath('security')}>Security &amp; Privacy details</a>
          </li>
          <li>
            <a href={routePath('decrypt')}>Reassemble &amp; Decrypt a package</a>
          </li>
        </ul>
      </div>
    </div>
  );
}
