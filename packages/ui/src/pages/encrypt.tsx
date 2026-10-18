import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  FileArchive,
  FileUp,
  FolderOpen,
  Lock,
  RotateCcw,
} from 'lucide-react';
import {
  CHUNK_SIZE_OPTIONS,
  DEFAULT_CHUNK_SIZE,
  estimateEncryptedSize,
  estimatePartCount,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  userMessageFor,
  ZIP_DOWNLOAD_LIMIT,
} from '@handshack/core';
import {
  Alert,
  FileChip,
  PasswordField,
  PasswordStrength,
  ProgressBlock,
  SegmentedControl,
  Stat,
} from '../components/ui.js';
import { chunkSizeLabel, fileTypeLabel, formatBytes } from '../format.js';
import { phaseLabel, useOperation } from '../hooks/use-operation.js';
import { usePlatform, type EncryptResult, type SelectedFileRef } from '../platform.js';

export function EncryptPage() {
  const services = usePlatform();
  const isDesktop = services.platform === 'desktop';

  const [file, setFile] = useState<SelectedFileRef | null>(null);
  const [chunkSize, setChunkSize] = useState<number>(DEFAULT_CHUNK_SIZE);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<EncryptResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const op = useOperation();

  const estimate = useMemo(() => {
    if (!file) return null;
    return {
      parts: estimatePartCount(file.size, file.name, chunkSize),
      size: estimateEncryptedSize(file.size, file.name),
    };
  }, [file, chunkSize]);

  const running = op.state.status === 'running';

  async function pickFile() {
    const picked = await services.selectFiles({ multiple: false, purpose: 'input' }).catch((e) => {
      setFormError(userMessageFor(e));
      return null;
    });
    if (picked && picked.length > 0) {
      setFile(picked[0]!);
      setFormError(null);
      setNotice(null);
    }
  }

  function validate(): boolean {
    if (!file) {
      setFormError('Choose a file first.');
      return false;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Enter a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return false;
    }
    if (password !== confirm) {
      setFormError('The passwords you entered do not match.');
      return false;
    }
    setFormError(null);
    return true;
  }

  async function start() {
    if (!validate() || !file) return;
    const operation = op.begin();

    try {
      let outputDir: string | undefined;
      let overwrite = false;
      if (isDesktop) {
        const dir = (await services.chooseOutputDirectory!()) ?? null;
        if (!dir) {
          op.reset();
          return;
        }
        outputDir = dir;
        const collisions = await services.findCollisions!(dir, file.name);
        if (collisions.length > 0) {
          const ok = window.confirm(
            `${collisions.length} file(s) with this package name already exist in the selected folder (e.g. ${collisions[0]}). Overwrite them?`,
          );
          if (!ok) {
            op.reset();
            return;
          }
          overwrite = true;
        }
      }
      const res = await services.encrypt(
        { input: file, password, chunkSize, outputDir, overwrite },
        operation.progress,
        operation.signal,
      );
      setResult(res);
      operation.succeed();
      setPassword('');
      setConfirm('');
    } catch (err) {
      operation.fail(err);
    }
  }

  function resetAll() {
    op.reset();
    setFile(null);
    setResult(null);
    setFormError(null);
    setNotice(null);
    setPassword('');
    setConfirm('');
  }

  async function copyName(name: string) {
    try {
      await navigator.clipboard.writeText(name);
      setNotice('Package name copied to clipboard.');
    } catch {
      setNotice(null);
    }
  }

  /* ---------- completion view ---------- */
  if (op.state.status === 'completed' && result) {
    const d = result.delivery;
    return (
      <div>
        <div className="complete-hero">
          <div className="complete-icon">
            <CheckCircle2 size={30} />
          </div>
          <h1>Package created</h1>
          <p className="muted mt-8">
            "{result.originalName}" was encrypted and split into {result.partCount} part
            {result.partCount === 1 ? '' : 's'}.
          </p>
        </div>

        <div className="card card-pad mt-16">
          <div className="stat-grid">
            <Stat label="Original file" value={result.originalName} />
            <Stat label="Original size" value={formatBytes(result.originalSize)} />
            <Stat label="Encryption" value={<span className="badge badge-success">AES-256-GCM</span>} />
            <Stat label="Integrity" value={<span className="badge badge-success">Verified</span>} />
            <Stat label="Parts" value={result.partCount} />
            <Stat label="Chunk size" value={chunkSizeLabel(result.chunkSize)} />
            <Stat label="Encrypted package" value={formatBytes(result.encryptedSize)} />
            <Stat label="Package ID" value={result.packageId} mono />
            <Stat label="Manifest" value={result.manifestName} mono />
          </div>
        </div>

        <div className="card card-pad">
          <div className="card-title">
            <FileArchive size={16} style={{ color: 'var(--accent)' }} />
            {d.kind === 'downloads' ? 'Save your package' : 'Files written'}
          </div>
          {d.kind === 'downloads' ? (
            <div className="stack">
              <p className="muted small">
                Share the manifest and all parts together — plus the password through a separate,
                private channel.
              </p>
              <div className="btn-row">
                {services.downloadZip && result.encryptedSize <= ZIP_DOWNLOAD_LIMIT && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() =>
                      services
                        .downloadZip!(result.manifestName, result.manifestText, d.parts)
                        .catch((e) => setNotice(userMessageFor(e)))
                    }
                  >
                    <Download size={16} /> Download package (.zip)
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    services
                      .downloadParts!(result.manifestName, d.manifestBlob, d.parts)
                      .catch((e) => setNotice(userMessageFor(e)))
                  }
                >
                  <Download size={16} /> Download files individually
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => copyName(result.partNames[0]?.replace(/\.part\d+\.hsp$/, '') ?? result.manifestName)}>
                  <Copy size={15} /> Copy package name
                </button>
              </div>
              {result.encryptedSize > ZIP_DOWNLOAD_LIMIT && (
                <Alert kind="info">
                  This package is large — download the files individually rather than as a ZIP.
                </Alert>
              )}
            </div>
          ) : (
            <div className="stack">
              <p className="muted small">
                {d.files.length} files written to{' '}
                <span className="mono">{d.directory}</span>
              </p>
              <div className="part-list">
                {d.files.map((f) => (
                  <div className="part-row ok" key={f}>
                    <span className="pstatus">
                      <CheckCircle2 size={15} />
                    </span>
                    <span className="pname">{f.split(/[/\\]/).pop()}</span>
                  </div>
                ))}
              </div>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => services.revealPath!(d.files[0]!)}
                >
                  <FolderOpen size={16} /> Reveal in folder
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => copyName(result.manifestName)}>
                  <Copy size={15} /> Copy manifest name
                </button>
              </div>
            </div>
          )}
          {notice && <p className="field-hint mt-8">{notice}</p>}
        </div>

        <div className="btn-row mt-24">
          <button type="button" className="btn btn-secondary" onClick={resetAll}>
            <RotateCcw size={15} /> Encrypt another file
          </button>
        </div>
      </div>
    );
  }

  /* ---------- main form ---------- */
  return (
    <div>
      <header className="page-head">
        <div className="eyebrow">Encrypt &amp; Split</div>
        <h1>Protect a file</h1>
        <p>
          The file is encrypted with AES-256-GCM on this device, then split into shareable parts.
          Nothing is uploaded anywhere.
        </p>
      </header>

      <div className="stack-lg">
        {/* Step 1 — file */}
        <section className="card card-pad">
          <div className="card-title">
            <span className="step-num">1</span> Select a file
          </div>
          <div className="card-sub">Any file type — photos, documents, videos, archives.</div>
          {file ? (
            <FileChip
              name={file.name}
              meta={`${fileTypeLabel(file.name)} · ${formatBytes(file.size)}`}
              onRemove={running ? undefined : () => setFile(null)}
            />
          ) : (
            <button type="button" className="dropzone" onClick={pickFile} style={{ width: '100%', font: 'inherit', color: 'inherit' }}>
              <div className="dropzone-icon">
                <FileUp size={20} />
              </div>
              <p className="lead">Choose a file</p>
              <p className="sub">Up to 4 GiB</p>
            </button>
          )}
        </section>

        {/* Step 2 — chunk size */}
        <section className="card card-pad">
          <div className="card-title">
            <span className="step-num">2</span> Part size
          </div>
          <div className="card-sub">
            How large each encrypted piece should be. Parts can be slightly larger than the selected
            size once package headers are included.
          </div>
          <SegmentedControl
            ariaLabel="Part size"
            options={CHUNK_SIZE_OPTIONS.map((c) => ({ value: c, label: chunkSizeLabel(c) }))}
            value={chunkSize}
            onChange={setChunkSize}
          />
          {file && estimate && (
            <p className="field-hint mt-8">
              Estimated output: ~{estimate.parts} part{estimate.parts === 1 ? '' : 's'} ·{' '}
              {formatBytes(estimate.size)} total + one small manifest file. Check your sharing
              method's size limits — we can't guarantee parts fit every email provider.
            </p>
          )}
        </section>

        {/* Step 3 — password */}
        <section className="card card-pad">
          <div className="card-title">
            <span className="step-num">3</span> Set a password
          </div>
          <div className="card-sub">
            A long, unique passphrase works best. It is never stored or sent anywhere — share it
            separately from the package. <strong>It cannot be recovered if lost.</strong>
          </div>
          <div className="stack">
            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              hint={`At least ${MIN_PASSWORD_LENGTH} characters; up to ${MAX_PASSWORD_LENGTH}. Longer is stronger.`}
            />
            <PasswordStrength password={password} />
            <PasswordField
              label="Confirm password"
              value={confirm}
              onChange={setConfirm}
              error={confirm && password !== confirm ? 'The passwords you entered do not match.' : undefined}
            />
          </div>
        </section>

        {/* Errors + run */}
        {formError && (
          <Alert kind="error">
            <span>{formError}</span>
          </Alert>
        )}
        {op.state.status === 'failed' && op.state.error && (
          <Alert kind="error">
            <span>{op.state.error.userMessage}</span>
          </Alert>
        )}
        {op.state.status === 'cancelled' && (
          <Alert kind="warn">
            <span>The operation was cancelled. Partial output was discarded.</span>
          </Alert>
        )}

        {running ? (
          <section className="card card-pad">
            <div className="stack">
              <ProgressBlock
                phaseLabel={phaseLabel(op.state.progress?.phase ?? 'preparing')}
                done={op.state.progress?.done ?? 0}
                total={op.state.progress?.total ?? 0}
              />
              <div className="btn-row">
                <button type="button" className="btn btn-danger-ghost" onClick={op.cancel}>
                  Cancel
                </button>
              </div>
            </div>
          </section>
        ) : (
          <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={!file}>
            <Lock size={17} /> Encrypt &amp; Split
          </button>
        )}

        {isDesktop === false && (
          <Alert kind="info">
            <span>
              Processed entirely in your browser. Your file, password, and keys are never sent to a
              server.
            </span>
          </Alert>
        )}
      </div>
    </div>
  );
}
