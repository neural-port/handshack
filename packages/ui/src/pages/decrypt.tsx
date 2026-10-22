import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  FolderOpen,
  PackageOpen,
  RotateCcw,
  Save,
} from 'lucide-react';
import { MAX_PASSWORD_LENGTH, userMessageFor } from '@handshack/core';
import {
  Alert,
  Dropzone,
  FileChip,
  PartList,
  PasswordField,
  ProgressBlock,
  Stat,
} from '../components/ui.js';
import { fileTypeLabel, formatBytes } from '../format.js';
import { phaseLabel, useOperation } from '../hooks/use-operation.js';
import {
  usePlatform,
  type DecryptResult,
  type PackageInspection,
  type SelectedFileRef,
} from '../platform.js';

export function DecryptPage() {
  const services = usePlatform();
  const isDesktop = services.platform === 'desktop';

  const [selected, setSelected] = useState<SelectedFileRef[]>([]);
  const [inspection, setInspection] = useState<PackageInspection | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<DecryptResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const op = useOperation();

  const running = op.state.status === 'running';
  const missing = useMemo(() => new Set(inspection?.missing ?? []), [inspection]);
  const present = useMemo(
    () => new Set(inspection?.matchedParts.map((p) => p.name) ?? []),
    [inspection],
  );
  const packageReady = !!inspection && missing.size === 0;
  const canRestore = packageReady && password.length > 0 && !running;

  async function inspect(files: SelectedFileRef[]) {
    if (files.length === 0) return;
    try {
      const insp = await services.inspectPackage(files);
      setInspection(insp);
      setInspectError(null);
      setNotice(null);
    } catch (err) {
      setInspection(null);
      setInspectError(userMessageFor(err));
    }
  }

  async function pickFiles() {
    const picked = await services
      .selectFiles({ multiple: true, purpose: 'package' })
      .catch((e) => {
        setInspectError(userMessageFor(e));
        return null;
      });
    if (picked && picked.length > 0) {
      setSelected(picked);
      setResult(null);
      await inspect(picked);
    }
  }

  async function addMore() {
    const picked = await services
      .selectFiles({ multiple: true, purpose: 'package' })
      .catch((e) => {
        setInspectError(userMessageFor(e));
        return null;
      });
    if (picked && picked.length > 0) {
      const merged = [...selected];
      for (const f of picked) if (!merged.some((m) => m.name === f.name)) merged.push(f);
      setSelected(merged);
      await inspect(merged);
    }
  }

  async function start() {
    if (!inspection) return;
    const operation = op.begin();
    try {
      let savePath: string | undefined;
      let overwrite = false;
      if (isDesktop) {
        const suggested = inspection.manifest.originalName || 'restored-file';
        const p = (await services.chooseSavePath!(suggested)) ?? null;
        if (!p) {
          op.reset();
          return;
        }
        savePath = p;
        if (await services.pathExists!(p)) {
          const ok = window.confirm(`"${p.split(/[/\\]/).pop()}" already exists. Overwrite it?`);
          if (!ok) {
            op.reset();
            return;
          }
          overwrite = true;
        }
      }
      const res = await services.decrypt(
        {
          manifest: inspection.manifestFile,
          parts: inspection.matchedParts,
          password,
          savePath,
          overwrite,
        },
        operation.progress,
        operation.signal,
      );
      setResult(res);
      operation.succeed();
      setPassword('');
    } catch (err) {
      operation.fail(err);
    }
  }

  function resetAll() {
    op.reset();
    setSelected([]);
    setInspection(null);
    setInspectError(null);
    setResult(null);
    setPassword('');
    setNotice(null);
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
          <h1>File restored successfully</h1>
          <p className="muted mt-8">
            Integrity verification passed — the restored bytes match the original file recorded in
            this package.
          </p>
        </div>

        <div className="card card-pad mt-16">
          <div className="stat-grid">
            <Stat label="Restored file" value={result.fileName} />
            <Stat label="Size" value={formatBytes(result.size)} />
            <Stat label="Authentication" value={<span className="badge badge-success">Passed</span>} />
            <Stat label="Integrity (SHA-256)" value={<span className="badge badge-success">Verified</span>} />
            <Stat label="Package ID" value={result.packageId} mono />
            <Stat label="SHA-256" value={`${result.sha256Hex.slice(0, 24)}…`} mono />
          </div>
        </div>

        <div className="card card-pad mt-16">
          <div className="stack">
            {d.kind === 'download' ? (
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    services.saveBlob!(result.fileName, d.blob).catch((e) => setNotice(userMessageFor(e)))
                  }
                >
                  <Download size={16} /> Save restored file
                </button>
              </div>
            ) : (
              <>
                <p className="muted small">
                  Written to <span className="mono">{d.path}</span>
                </p>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => services.revealPath!(d.path)}
                  >
                    <FolderOpen size={16} /> Reveal in folder
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(result.sha256Hex);
                        setNotice('SHA-256 copied.');
                      } catch {
                        setNotice('Copy failed. Select the hash and copy it manually.');
                      }
                    }}
                  >
                    <Copy size={15} /> Copy SHA-256
                  </button>
                </div>
              </>
            )}
            {notice && <p className="field-hint">{notice}</p>}
          </div>
        </div>

        <div className="btn-row mt-24">
          <button type="button" className="btn btn-secondary" onClick={resetAll}>
            <RotateCcw size={15} /> Restore another package
          </button>
        </div>
      </div>
    );
  }

  /* ---------- form ---------- */
  return (
    <div className="flow">
      <header className="flow-head">
        <p className="flow-kicker">Restore &amp; decrypt</p>
        <h1>Restore a file</h1>
        <p className="flow-lede">
          Select the manifest and every part of a package, then enter its password.
        </p>
      </header>

      <ol className="steps">
        <li className={`step${packageReady ? ' is-done' : ' is-current'}`}>
          <span className="step-marker">1</span>
          <div className="step-body">
            <div className="step-head">
              <h2>Select package files</h2>
              <span className="step-status">
                {packageReady ? 'Complete' : missing.size > 0 ? `${missing.size} missing` : 'Required'}
              </span>
            </div>
            <p className="step-help">
              Choose the <span className="mono">.hsmanifest.json</span> file and every{' '}
              <span className="mono">.hsp</span> part
              {services.capabilities.zipDownload ? ', or a ZIP containing them' : ''}.
            </p>
            <Dropzone
              lead="Choose package files"
              sub="Select the manifest and its parts together"
              multiple
              onPick={pickFiles}
              icon={<PackageOpen size={22} />}
            />

            {selected.length > 0 && (
              <div className="selected-files">
                {selected.map((f) => (
                  <FileChip
                    key={f.name}
                    name={f.name}
                    meta={`${fileTypeLabel(f.name)} · ${formatBytes(f.size)}`}
                  />
                ))}
              </div>
            )}

            {inspection && (
              <div className="inspection">
                <div className="inspection-summary">
                  <div>
                    <span className="field-label">Original file</span>
                    <strong>{inspection.manifest.originalName}</strong>
                  </div>
                  <div>
                    <span className="field-label">Parts present</span>
                    <strong>
                      {present.size} / {inspection.manifest.partCount}
                    </strong>
                  </div>
                  <div>
                    <span className="field-label">Original size</span>
                    <strong>{formatBytes(inspection.manifest.originalSize)}</strong>
                  </div>
                  {missing.size > 0 && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={addMore}>
                      Add missing files
                    </button>
                  )}
                </div>

                <PartList names={inspection.manifest.parts.map((p) => p.name)} present={present} />

                {missing.size > 0 && (
                  <Alert kind="warn">
                    <span>
                      {missing.size} part{missing.size === 1 ? ' is' : 's are'} missing. Add the
                      remaining files to continue.
                    </span>
                  </Alert>
                )}
                {inspection.unexpected.length > 0 && (
                  <Alert kind="warn">
                    <span>
                      These files don't belong to this package:{' '}
                      {inspection.unexpected.slice(0, 5).join(', ')}
                      {inspection.unexpected.length > 5 ? '…' : ''}
                    </span>
                  </Alert>
                )}
              </div>
            )}

            {inspectError && (
              <div className="mt-8">
                <Alert kind="error">
                  <span>{inspectError}</span>
                </Alert>
              </div>
            )}
          </div>
        </li>

        <li className={`step${password ? ' is-done' : ''}`}>
          <span className="step-marker">2</span>
          <div className="step-body">
            <div className="step-head">
              <h2>Enter the password</h2>
              <span className="step-status">{password ? 'Entered' : 'Required'}</span>
            </div>
            <p className="step-help">
              The password used when the package was created. It is used locally and never saved.
            </p>
            <PasswordField
              label="Package password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              placeholder="Enter the passphrase"
              hint={`Up to ${MAX_PASSWORD_LENGTH} characters.`}
            />
          </div>
        </li>
      </ol>

      <div className="flow-feedback" aria-live="polite">
        {op.state.status === 'failed' && op.state.error && (
          <Alert kind="error">
            <span>{op.state.error.userMessage}</span>
          </Alert>
        )}
        {op.state.status === 'cancelled' && (
          <Alert kind="warn">
            <span>The operation was cancelled. No partial file was kept.</span>
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
              <strong>{inspection?.manifest.originalName ?? 'No package selected'}</strong>
              <span>
                {inspection
                  ? `${present.size} of ${inspection.manifest.partCount} parts present`
                  : 'Select the manifest and all parts to continue.'}
              </span>
            </>
          )}
        </div>
        {running ? (
          <button type="button" className="btn btn-secondary" onClick={op.cancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={start} disabled={!canRestore}>
            <Save size={17} /> Restore file
          </button>
        )}
      </div>

      <p className="flow-note">
        The original file is released only after the password is authenticated and the full-file
        integrity check passes.
      </p>
    </div>
  );
}
