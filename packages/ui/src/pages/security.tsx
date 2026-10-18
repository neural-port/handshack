import { usePlatform } from '../platform.js';

export function SecurityPage() {
  const { platform } = usePlatform();
  const isWeb = platform === 'web';
  return (
    <div>
      <header className="page-head">
        <div className="eyebrow">Security &amp; Privacy</div>
        <h1>What HandShack does — and doesn't — protect</h1>
        <p>Honest security documentation, not marketing.</p>
      </header>

      <div className="prose">
        <h2>The cryptography</h2>
        <table className="spec-table">
          <tbody>
            <tr>
              <td>Cipher</td>
              <td>AES-256-GCM authenticated encryption (128-bit tags)</td>
            </tr>
            <tr>
              <td>Key derivation</td>
              <td>scrypt — N=32768, r=8, p=1, 32-byte key (RFC 7914)</td>
            </tr>
            <tr>
              <td>Salt</td>
              <td>16 bytes, cryptographically random, unique per package</td>
            </tr>
            <tr>
              <td>Nonces</td>
              <td>
                Deterministic per-record counters bound to a per-package key — nonce reuse under one
                key is impossible by construction
              </td>
            </tr>
            <tr>
              <td>Integrity</td>
              <td>
                Per-record GCM authentication + SHA-256 of the original file, verified after
                decryption
              </td>
            </tr>
            <tr>
              <td>Randomness</td>
              <td>OS/Web Crypto CSPRNG only — never Math.random()</td>
            </tr>
          </tbody>
        </table>

        <h2>Passwords</h2>
        <ul>
          <li>Passwords are never stored, logged, embedded in the manifest, or transmitted.</li>
          <li>A lost password cannot be recovered — there is no backdoor or recovery key.</li>
          <li>
            Long, unique passphrases resist guessing far better than short complex passwords. scrypt
            slows offline guessing, but a weak password remains weak.
          </li>
          <li>
            Share the password through a separate channel from the package files — never in the same
            email or message.
          </li>
        </ul>

        <div className="callout warn">
          <p>
            <strong>Anyone who obtains the complete package and the correct password may be able to
            recover the original file.</strong> Keep your password private and share it separately
            from the encrypted files.
          </p>
        </div>

        <h2>What the encrypted parts contain</h2>
        <p>
          Only ciphertext. File contents are encrypted before splitting, and every part also carries
          authentication tags. A part on its own reveals nothing about the contents — but it is not
            "anonymous": the manifest records the original file name and size (metadata, not
          contents). Treat the package as sensitive metadata, not as plaintext.
        </p>

        <h2>Threat model — what this is for</h2>
        <ul>
          <li>Sending a sensitive file through channels you don't fully trust.</li>
          <li>Keeping a file confidential while it transits email or cloud storage.</li>
          <li>Splitting a large encrypted payload across size-limited channels.</li>
        </ul>

        <h2>Limitations — what it can't defend against</h2>
        <ul>
          <li>
            <strong>A compromised device.</strong> Malware, keyloggers, a compromised OS, malicious
            browser extensions, or someone with access to an unlocked device can capture your
            password or file before encryption.
          </li>
          <li>
            <strong>A compromised browser or website deployment.</strong> If the site serving the
            web app is compromised, the code itself could be malicious. Prefer the desktop app for
            high-sensitivity use, and verify you're on the real HandShack URL.
          </li>
          <li>
            <strong>Memory disclosure.</strong> JavaScript gives no reliable way to erase every copy
            of a key or plaintext from memory. HandShack zeroes buffers it controls, but cannot
            guarantee every copy is gone.
          </li>
          <li>
            <strong>Traffic/metadata analysis.</strong> File sizes and part counts are visible to
            anyone who sees the package — encryption hides contents, not existence or size.
          </li>
          <li>
            <strong>Weak passwords.</strong> scrypt raises the cost of guessing; it cannot make a
            guessable password safe.
          </li>
          <li>
            <strong>Future cryptanalysis.</strong> AES-256-GCM and scrypt are strong today. Quantum
            computers would halve AES's effective strength (Grover), still leaving ~128 bits —
            adequate, not infinite.
          </li>
        </ul>

        {isWeb && (
          <>
            <h2>Browser-specific notes</h2>
            <ul>
              <li>
                The web demo performs all processing locally in your browser and is designed not to
                upload file contents or passwords to a HandShack server.
              </li>
              <li>
                Your browser, extensions, OS, hosting provider, or device may still expose certain
                metadata or affect your privacy.
              </li>
              <li>
                For high-sensitivity files, prefer the installed desktop application, which keeps
                cryptography in a separate, isolated process.
              </li>
            </ul>
          </>
        )}

        <h2>Vulnerability reports</h2>
        <p>
          If you find a security issue, please report it privately through the repository's security
          policy rather than opening a public issue. See <code>docs/SECURITY.md</code> and{' '}
          <code>docs/ENCRYPTION_FORMAT.md</code> in the repository for the full format
          specification.
        </p>
      </div>
    </div>
  );
}
