/**
 * Object URLs for local blobs (photo previews). One URL per id, revoked when the id disappears or the
 * owner is destroyed, so long field days do not leak memory.
 */
export class BlobUrls {
  private readonly urls = new Map<string, { readonly blob: Blob; readonly url: string }>();

  url(id: string, blob: Blob | null): string | null {
    if (!blob) return null;
    const hit = this.urls.get(id);
    // Rows re-read from storage come back as new Blob objects with the same bytes; same id and size is the same photo.
    if (hit && (hit.blob === blob || hit.blob.size === blob.size)) return hit.url;
    if (hit) URL.revokeObjectURL(hit.url);
    const url = URL.createObjectURL(blob);
    this.urls.set(id, { blob, url });
    return url;
  }

  /** Revoke every URL whose id is not in `keep`. */
  prune(keep: ReadonlySet<string>): void {
    for (const [id, entry] of this.urls) {
      if (!keep.has(id)) {
        URL.revokeObjectURL(entry.url);
        this.urls.delete(id);
      }
    }
  }

  clear(): void {
    for (const entry of this.urls.values()) URL.revokeObjectURL(entry.url);
    this.urls.clear();
  }
}
