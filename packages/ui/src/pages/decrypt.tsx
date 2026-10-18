import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  FileCheck2,
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
      .catch(() => null);
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
            <Stat
              label="Authentication"
              value={<span className="badge badge-success">Passed</span>}
            />
            <Stat
              label="Integrity (SHA-256)"
              value={<span className="badge badge-success">Verified</span>}
            />
            <Stat label="Package ID" value={result.packageId} mono />
            <Stat label="SHA-256" value={`${result.sha256Hex.slice(0, 24)}…`} mono />
          </div>
        </div>

        <div className="card card-pad">
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
                      await navigator.clipboard.writeText(result.sha256Hex).catch(() => undefined);
                      setNotice('SHA-256 copied.');
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
    <div>
      <header className="page-head">
        <div className="eyebrow">Reassemble &amp; Decrypt</div>
        <h1>Restore a file</h1>
        <p>
          Select the manifest and every part of a HandShack package, enter the password, and get the
          original file back — byte for byte.
        </p>
      </header>

      <div className="stack-lg">
        <section className="card card-pad">
          <div className="card-title">
            <span className="step-num">1</span> Select package files
          </div>
          <div className="card-sub">
            Pick the <span className="mono">.hsmanifest.json</span> file and all{' '}
            <span className="mono">.hsp</span> parts
            {services.capabilities.zipDownload ? ' — or a ZIP containing the whole package' : ''}.
          </div>

          <Dropzone
            lead="Choose package files"
            sub="Manifest + all parts · you can select them together"
            multiple
            onPick={pickFiles}
            icon={<PackageOpen size={20} />}
          />

          {selected.length > 0 && (
            <div className="stack mt-16">
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
            <div className="stack mt-16">
              <div className="row-between wrap">
                <div className="row">
                  <FileCheck2 size={16} style={{ color: 'var(--accent)' }} />
                  <strong style={{ fontSize: 14 }}>
                    {inspection.manifest.originalName}
                  </strong>
                  <span className="badge badge-muted">
                    {inspection.manifest.partCount} parts
                  </span>
                  <span className="badge badge-muted">
                    {formatBytes(inspection.manifest.originalSize)}
                  </span>
                </div>
                {missing.size > 0 && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addMore}>
                    Add more files
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
            <div className="mt-16">
              <Alert kind="error">
                <span>{inspectError}</span>
              </Alert>
            </div>
          )}
        </section>

        <section className="card card-pad">
          <div className="card-title">
            <span className="step-num">2</span> Enter the password
          </div>
          <div className="card-sub">
            The same password used when the package was created (up to {MAX_PASSWORD_LENGTH} characters).
          </div>
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            placeholder="Package password"
          />
        </section>

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
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={start}
            disabled={!inspection || missing.size > 0 || !password}
          >
            <Save size={17} /> Reassemble &amp; Decrypt
          </button>
        )}

        {missing.size > 0 && inspection && (
          <Alert kind="info">
            <span>Decryption stays locked until every part of the package is present.</span>
          </Alert>
        )}
      </div>
    </div>
  );
}
