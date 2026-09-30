import { inject, Injectable, signal } from '@angular/core';
import { PocketBaseService, VideoRecord } from './pocketbase.service';

export interface UploadTask {
  title: string;
  category: string;
  visibility: string;
}

@Injectable({
  providedIn: 'root',
})
export class UploadService {
  private readonly pbService = inject(PocketBaseService);

  // Upload state
  isUploading = signal(false);
  isComplete = signal(false);
  isMinimized = signal(false);
  progress = signal(0);
  progressBytes = signal<{ loaded: string; total: string } | null>(null);
  statusText = signal<string>('');
  currentTask = signal<UploadTask | null>(null);
  error = signal<string | null>(null);

  private activeXhr: XMLHttpRequest | null = null;

  // Callback to trigger feed refresh when finished
  onUploadSuccess?: () => void;

  startUpload(formData: FormData, meta: UploadTask): Promise<VideoRecord> {
    this.cancelUpload(); // abort any previous upload if still active

    this.isUploading.set(true);
    this.isComplete.set(false);
    this.isMinimized.set(false);
    this.progress.set(0);
    this.progressBytes.set(null);
    this.error.set(null);
    this.currentTask.set(meta);
    this.statusText.set('Starting upload in background...');

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.activeXhr = xhr;

      const url = this.pbService.pb.buildURL('/api/collections/videos/records');
      xhr.open('POST', url);

      if (this.pbService.pb.authStore.token) {
        xhr.setRequestHeader('Authorization', this.pbService.pb.authStore.token);
      }

      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (event.lengthComputable) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          this.progress.set(percent);
          this.progressBytes.set({
            loaded: this.formatBytes(event.loaded),
            total: this.formatBytes(event.total),
          });

          if (percent < 100) {
            this.statusText.set(`Uploading (${percent}%)...`);
          } else {
            this.statusText.set('Processing & saving clip...');
          }
        }
      };

      xhr.onload = () => {
        this.activeXhr = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            this.isUploading.set(false);
            this.isComplete.set(true);
            this.progress.set(100);
            this.statusText.set('Upload complete!');

            if (this.onUploadSuccess) {
              this.onUploadSuccess();
            }

            // Auto-dismiss the completed card after 6 seconds
            setTimeout(() => {
              if (this.isComplete()) {
                this.dismiss();
              }
            }, 6000);

            resolve(data as VideoRecord);
          } catch {
            resolve(xhr.responseText as any);
          }
        } else {
          this.isUploading.set(false);
          let errMsg = 'Failed to upload video to PocketBase.';
          try {
            const errData = JSON.parse(xhr.responseText);
            const fieldErrors = errData?.data;
            if (fieldErrors && typeof fieldErrors === 'object') {
              errMsg = Object.entries(fieldErrors)
                .map(([field, obj]: [string, any]) => `${field}: ${obj?.message || 'invalid'}`)
                .join(', ');
            } else if (errData?.message) {
              errMsg = errData.message;
            }
          } catch {}

          this.error.set(errMsg);
          reject(new Error(errMsg));
        }
      };

      xhr.onerror = () => {
        this.activeXhr = null;
        this.isUploading.set(false);
        const errMsg = 'Network error during upload. Please check your connection.';
        this.error.set(errMsg);
        reject(new Error(errMsg));
      };

      xhr.onabort = () => {
        this.activeXhr = null;
        this.isUploading.set(false);
        this.statusText.set('Upload cancelled.');
      };

      xhr.send(formData);
    });
  }

  cancelUpload(): void {
    if (this.activeXhr) {
      this.activeXhr.abort();
      this.activeXhr = null;
    }
    this.isUploading.set(false);
    this.isComplete.set(false);
    this.currentTask.set(null);
    this.progress.set(0);
    this.progressBytes.set(null);
  }

  dismiss(): void {
    this.isComplete.set(false);
    this.error.set(null);
    this.currentTask.set(null);
    this.progress.set(0);
    this.progressBytes.set(null);
  }

  toggleMinimize(): void {
    this.isMinimized.update((v) => !v);
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
