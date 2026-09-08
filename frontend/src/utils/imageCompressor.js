/**
 * imageCompressor.js
 * 
 * Compresses images before storing them in the database.
 * Converts any image to JPEG at reduced dimensions and quality,
 * keeping the base64 output under ~30KB regardless of input size.
 * 
 * Usage:
 *   import { compressImage } from '../utils/imageCompressor';
 *   const compressed = await compressImage(file);  // returns base64 string
 */

const MAX_SIZE   = 200;   // max width or height in pixels
const QUALITY    = 0.7;   // JPEG quality (0-1) — 0.7 gives good quality at ~20-40KB
const MAX_BYTES  = 35000; // ~35KB target for stored base64

/**
 * Compress a File/Blob to a small base64 JPEG.
 * @param {File|Blob|string} input  — File object, Blob, or existing base64 string
 * @param {object} opts
 * @param {number} opts.maxSize     — max dimension in px (default 200)
 * @param {number} opts.quality     — JPEG quality 0-1 (default 0.7)
 * @returns {Promise<string>}       — compressed base64 data URL
 */
export async function compressImage(input, opts = {}) {
  const maxSize = opts.maxSize  || MAX_SIZE;
  const quality = opts.quality  || QUALITY;

  // Load image from File, Blob, or existing base64 string
  const src = input instanceof File || input instanceof Blob
    ? await readFileAsDataURL(input)
    : input; // already a base64/URL string

  if (!src) throw new Error('No image source provided');

  // If it's already small enough, return as-is
  if (typeof src === 'string' && src.startsWith('data:')) {
    const bytes = Math.round((src.length * 3) / 4);
    if (bytes <= MAX_BYTES) return src;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Calculate new dimensions preserving aspect ratio
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
      } else {
        if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
      }

      // Draw on canvas and export
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      // White background for transparency (PNG → JPEG)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      // Try progressively lower quality until under MAX_BYTES
      let q = quality;
      let result = canvas.toDataURL('image/jpeg', q);
      while (result.length > MAX_BYTES * 1.4 && q > 0.3) {
        q -= 0.1;
        result = canvas.toDataURL('image/jpeg', q);
      }

      resolve(result);
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = src;
  });
}

/**
 * Compress an existing base64 image already stored in the database.
 * Returns null if the input is not a base64 image (e.g. it's a URL).
 */
export async function recompressBase64(base64) {
  if (!base64 || !base64.startsWith('data:')) return null;
  const bytes = Math.round((base64.length * 3) / 4);
  if (bytes <= MAX_BYTES) return base64; // already small enough
  return compressImage(base64);
}

/**
 * Get display size info for debugging.
 */
export function getBase64Size(base64) {
  if (!base64 || !base64.startsWith('data:')) return null;
  const bytes = Math.round((base64.length * 3) / 4);
  return {
    bytes,
    kb: Math.round(bytes / 1024),
    isLarge: bytes > MAX_BYTES,
  };
}

// Helper: read File as data URL
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e  => resolve(e.target.result);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Migration: recompress heavy base64 logos already in MongoDB.
 * Called once from WorkspaceSettings — silently replaces heavy logos with small ones.
 */
export async function migrateHeavyLogos(workspaces, updateWorkspaceFn) {
  if (!workspaces || workspaces.length === 0) return;
  
  for (const ws of workspaces) {
    if (!ws.logoUrl || !ws.logoUrl.startsWith('data:')) continue;
    
    const { bytes } = getBase64Size(ws.logoUrl);
    if (bytes <= 35000) continue; // already small — skip
    
    console.log(`Compressing logo for workspace "${ws.name}" (${Math.round(bytes/1024)}KB → ~30KB)`);
    try {
      const compressed = await recompressBase64(ws.logoUrl);
      if (compressed && compressed !== ws.logoUrl) {
        await updateWorkspaceFn(ws.id, { logoUrl: compressed });
        console.log(`✅ Logo compressed for "${ws.name}"`);
      }
    } catch (e) {
      console.warn(`Could not compress logo for "${ws.name}":`, e.message);
    }
  }
}
