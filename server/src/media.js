/**
 * A Content-Type reduced to its bare type: "audio/webm;codecs=opus" becomes
 * "audio/webm".
 *
 * The blob store keeps whatever type an uploader sent, and GET /api/blob only
 * serves a fixed list of exact types inline. A browser's MediaRecorder labels
 * its output with codec parameters, so a voice note stored as-is matched none
 * of them and came back as a download instead of playing.
 */
export function baseMime(raw) {
  return String(raw ?? '').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
}
