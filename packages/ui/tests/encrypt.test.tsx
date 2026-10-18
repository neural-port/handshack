import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/app.js';
import { fileRef, makePlatform, sampleManifest } from './mock-platform.js';
import type { SelectedFileRef } from '../src/platform.js';

function renderApp(platform = makePlatform()) {
  return render(<App services={platform} />);
}

describe('Encrypt & Split page', () => {
  it('renders the workflow steps', async () => {
    window.location.hash = '#/app/encrypt';
    renderApp();
    expect(await screen.findByText('Select a file')).toBeInTheDocument();
    expect(screen.getByText('Part size')).toBeInTheDocument();
    expect(screen.getByText('Set a password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /encrypt & split/i })).toBeDisabled();
  });

  it('shows file details and an estimate after selection', async () => {
    window.location.hash = '#/app/encrypt';
    renderApp();
    await userEvent.click(await screen.findByText('Choose a file'));
    expect(await screen.findByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByText(/estimated output/i)).toBeInTheDocument();
  });

  it('requires a password ≥8 chars before running', async () => {
    const platform = makePlatform();
    window.location.hash = '#/app/encrypt';
    renderApp(platform);
    await userEvent.click(await screen.findByText('Choose a file'));
    await userEvent.click(screen.getByRole('button', { name: /encrypt & split/i }));
    expect(
      await screen.findByText(/enter a password of at least 8 characters/i),
    ).toBeInTheDocument();
    expect(platform.encrypt).not.toHaveBeenCalled();
  });

  it('rejects mismatched confirmation', async () => {
    const platform = makePlatform();
    window.location.hash = '#/app/encrypt';
    renderApp(platform);
    await userEvent.click(await screen.findByText('Choose a file'));
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-passphrase-1');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different-phrase');
    expect(screen.getByText('The passwords you entered do not match.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /encrypt & split/i }));
    expect(platform.encrypt).not.toHaveBeenCalled();
  });

  it('runs the job and shows the completion summary', async () => {
    const platform = makePlatform();
    window.location.hash = '#/app/encrypt';
    renderApp(platform);
    await userEvent.click(await screen.findByText('Choose a file'));
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-passphrase-1');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-long-passphrase-1');
    await userEvent.click(screen.getByRole('button', { name: /encrypt & split/i }));
    expect(await screen.findByText('Package created')).toBeInTheDocument();
    expect(platform.encrypt).toHaveBeenCalledOnce();
    expect(screen.getByText('photo.jpg.hsmanifest.json')).toBeInTheDocument();
  });

  it('shows a friendly error when the job fails', async () => {
    const platform = makePlatform({
      encrypt: vi.fn(async () => {
        throw Object.assign(new Error('x'), { code: 'io-error' });
      }),
    });
    window.location.hash = '#/app/encrypt';
    renderApp(platform);
    await userEvent.click(await screen.findByText('Choose a file'));
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-passphrase-1');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-long-passphrase-1');
    await userEvent.click(screen.getByRole('button', { name: /encrypt & split/i }));
    expect(await screen.findByText(/could not be read or written/i)).toBeInTheDocument();
  });
});

describe('Reassemble & Decrypt page', () => {
  it('guides selection and inspects the package', async () => {
    const platform = makePlatform({
      selectFiles: vi.fn(async () => [
        fileRef('photo.jpg.hsmanifest.json', 800),
        fileRef('photo.jpg.part001.hsp', 1024 * 1024),
        fileRef('photo.jpg.part002.hsp', 1024 * 1024),
        fileRef('photo.jpg.part003.hsp', 800_000),
      ]),
    });
    window.location.hash = '#/app/decrypt';
    renderApp(platform);
    await userEvent.click(await screen.findByText('Choose package files'));
    // part names appear in the selected-files list AND the manifest part list
    expect((await screen.findAllByText('photo.jpg.part001.hsp')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('photo.jpg.part003.hsp').length).toBeGreaterThan(0);
    expect(platform.inspectPackage).toHaveBeenCalled();
  });

  it('blocks decryption while parts are missing', async () => {
    const platform = makePlatform({
      selectFiles: vi.fn(async () => [
        fileRef('photo.jpg.hsmanifest.json', 800),
        fileRef('photo.jpg.part001.hsp', 1024 * 1024),
      ]),
      inspectPackage: vi.fn(async (files: SelectedFileRef[]) => ({
        manifest: sampleManifest(3),
        manifestFile: fileRef('photo.jpg.hsmanifest.json', 800),
        matchedParts: files.filter((f) => f.name.endsWith('.hsp')),
        missing: ['photo.jpg.part002.hsp', 'photo.jpg.part003.hsp'],
        unexpected: [] as string[],
      })),
    });
    window.location.hash = '#/app/decrypt';
    renderApp(platform);
    await userEvent.click(await screen.findByText('Choose package files'));
    expect(await screen.findByText(/2 parts are missing/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /reassemble & decrypt/i });
    expect(btn).toBeDisabled();
    expect(platform.decrypt).not.toHaveBeenCalled();
  });
});

describe('navigation', () => {
  it('routes between app pages via the sidebar', async () => {
    window.location.hash = '#/app';
    renderApp();
    expect(await screen.findByText('Your files. Your control.')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('link', { name: 'Security & Privacy' })[0]!);
    await waitFor(() => {
      expect(window.location.hash).toBe('#/app/security');
    });
    expect(
      await screen.findByText(/what handshack does — and doesn't — protect/i),
    ).toBeInTheDocument();
  });

  it('renders the landing page at the root for the web platform', async () => {
    window.location.hash = '#/';
    renderApp();
    expect(await screen.findByText(/Private files\./)).toBeInTheDocument();
    expect(screen.getByText('Try HandShack')).toBeInTheDocument();
  });
});
