/**
 * Input media rules: video files must be 1080p or smaller.
 * The size ceiling lives in `validateInputFileSize`.
 */
import { MAX_VIDEO_SHORT_SIDE } from '../constants.js';
import { HandshackError } from '../errors.js';
import type { ByteSource } from '../types.js';
import { isVideoFileName, readVideoDimensions } from './video.js';

export { VIDEO_EXTENSIONS, isVideoFileName, readVideoDimensions, type VideoDimensions } from './video.js';

/**
 * Enforce the 1080p rule for video inputs.
 * Non-video files pass through untouched. A video whose container cannot be
 * parsed is rejected: a limit that cannot be checked must not be silently skipped.
 */
export async function validateVideoInput(name: string, source: ByteSource): Promise<void> {
  if (!isVideoFileName(name)) return;

  const dims = await readVideoDimensions(source);
  if (!dims) {
    throw new HandshackError(
      'video-unreadable',
      `cannot read video dimensions for ${name}`,
      'HandShack cannot verify the resolution of this video format. Use MP4, MOV, 3GP, MKV, or WebM.',
    );
  }

  const shortSide = Math.min(dims.width, dims.height);
  if (shortSide > MAX_VIDEO_SHORT_SIDE) {
    throw new HandshackError(
      'video-resolution-too-high',
      `video is ${dims.width}x${dims.height}`,
      `This video is ${dims.width}×${dims.height}. Use a version that is 1080p or smaller.`,
    );
  }
}
