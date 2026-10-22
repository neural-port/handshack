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
  const passwordOk =
    password.length >= MIN_PASSWORD_LENGTH && confirm.length > 0 && password === confirm;

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

  /* ---------- completion ---------- */
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
            <Stat label="Part size" value={chunkSizeLabel(result.chunkSize)} />
            <Stat label="Encrypted package" value={formatBytes(result.encryptedSize)} />
            <Stat label="Package ID" value={result.packageId} mono />
            <Stat label="Manifest" value={result.manifestName} mono />
          </div>
        </div>

        <div className="card card-pad mt-16">
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
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    copyName(result.partNames[0]?.replace(/\.part\d+\.hsp$/, '') ?? result.manifestName)
                  }
                >
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
                {d.files.length} files written to <span className="mono">{d.directory}</span>
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
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => copyName(result.manifestName)}
                >
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

  /* ---------- form ---------- */
  return (
    <div className="flow">
      <header className="flow-head">
        <p className="flow-kicker">Encrypt &amp; split</p>
        <h1>Protect a file</h1>
        <p className="flow-lede">
          Encrypt it on this device, then split the package into parts you can share.
        </p>
      </header>

      <ol className="steps">
        <li className={`step${file ? ' is-done' : ' is-current'}`}>
          <span className="step-marker">1</span>
          <div className="step-body">
            <div className="step-head">
              <h2>Choose a file</h2>
              <span className="step-status">{file ? 'Selected' : 'Required'}</span>
            </div>
            {file ? (
              <FileChip
                name={file.name}
                meta={`${fileTypeLabel(file.name)} · ${formatBytes(file.size)}`}
                onRemove={running ? undefined : () => setFile(null)}
              />
            ) : (
              <button type="button" className="file-drop" onClick={pickFile}>
                <FileUp size={22} />
                <span className="file-drop-title">Browse files</span>
                <span className="file-drop-sub">Any type up to 1 GB · videos 1080p max · stays on this device</span>
              </button>
            )}
          </div>
        </li>

        <li className="step">
          <span className="step-marker">2</span>
          <div className="step-body">
            <div className="step-head">
              <h2>Part size</h2>
              {estimate && (
                <span className="step-status">
                  About {estimate.parts} part{estimate.parts === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <p className="step-help">The largest size of each file you will share.</p>
            <SegmentedControl
              ariaLabel="Part size"
              options={CHUNK_SIZE_OPTIONS.map((c) => ({ value: c, label: chunkSizeLabel(c) }))}
              value={chunkSize}
              onChange={setChunkSize}
            />
            {file && estimate && (
              <p className="step-help mt-8">
                Whole package about {formatBytes(estimate.size)}, plus one small manifest file.
              </p>
            )}
          </div>
        </li>

        <li className={`step${passwordOk ? ' is-done' : ''}`}>
          <span className="step-marker">3</span>
          <div className="step-body">
            <div className="step-head">
              <h2>Set a password</h2>
              <span className="step-status">{passwordOk ? 'Confirmed' : 'Required'}</span>
            </div>
            <p className="step-help">
              Share it through a separate channel. It cannot be recovered if lost.
            </p>
            <div className="password-pair">
              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                hint={`At least ${MIN_PASSWORD_LENGTH} characters; up to ${MAX_PASSWORD_LENGTH}.`}
              />
              <PasswordField
                label="Confirm password"
                value={confirm}
                onChange={setConfirm}
                error={
                  confirm && password !== confirm ? 'The passwords you entered do not match.' : undefined
                }
              />
              <div className="password-strength">
                <PasswordStrength password={password} />
              </div>
            </div>
          </div>
        </li>
      </ol>

      <div className="flow-feedback" aria-live="polite">
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
      </div>

      <div className="flow-action">
        <div className="flow-action-copy">
          {running ? (
            <ProgressBlock
              phaseLabel={phaseLabel(op.state.progress?.phase ?? 'preparing')}
              done={op.state.progress?.done ?? 0}
              total={op.state.progress?.total ?? 0}
            />
          ) : (
            <>
              <strong>{file ? file.name : 'No file selected'}</strong>
              <span>
                {file && estimate
                  ? `${estimate.parts} part${estimate.parts === 1 ? '' : 's'} · ${formatBytes(estimate.size)}`
                  : 'Choose a file to continue.'}
              </span>
            </>
          )}
        </div>
        {running ? (
          <button type="button" className="btn btn-secondary" onClick={op.cancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={start} disabled={!file}>
            <Lock size={17} /> Encrypt &amp; split
          </button>
        )}
      </div>

      <p className="flow-note">
        {isDesktop
          ? 'Encryption protects the content. Splitting only changes how the package is transferred. The package is written to the folder you choose.'
          : 'Processed in your browser. Your file and password are never sent to a server. Splitting alone is not protection.'}
      </p>
    </div>
  );
}
