import { computed, Injectable, signal } from '@angular/core';
import PocketBase, { RecordAuthResponse, RecordModel } from 'pocketbase';

@Injectable({
  providedIn: 'root',
})
export class PocketBaseService {
  // PocketBase instance URL - customize as needed
  readonly pb = new PocketBase('http://100.118.206.60:3001/');

  // Reactive state for the current authenticated user
  readonly currentUser = signal<RecordModel | null>(this.pb.authStore.record);
  readonly isLoggedIn = computed(() => !!this.currentUser());

  constructor() {
    // Keep signal synchronized with PocketBase AuthStore changes
    this.pb.authStore.onChange((_token, record) => {
      this.currentUser.set(record);
    });

    // Auto-refresh token on initial app load if a session is stored
    if (this.pb.authStore.isValid) {
      this.pb
        .collection('users')
        .authRefresh()
        .then((authData) => {
          this.currentUser.set(authData.record);
        })
        .catch(() => {
          this.logout();
        });
    }
  }

  /**
   * Register a new user using Email & Password.
   * Automatically logs in upon successful registration.
   */
  async signUpWithEmail(data: {
    email: string;
    password: string;
    passwordConfirm: string;
    name?: string;
  }): Promise<RecordModel> {
    const user = await this.pb.collection('users').create(data);
    await this.loginWithEmail(data.email, data.password);
    return user;
  }

  /**
   * Authenticate an existing user with Email & Password.
   */
  async loginWithEmail(email: string, password: string): Promise<RecordAuthResponse<RecordModel>> {
    return await this.pb.collection('users').authWithPassword(email, password);
  }

  /**
   * Authenticate or register using Google OAuth2 popup.
   * PocketBase handles automatic user creation if the account does not exist yet.
   */
  async loginWithGoogle(): Promise<RecordAuthResponse<RecordModel>> {
    return await this.pb.collection('users').authWithOAuth2({
      provider: 'google',
    });
  }

  /**
   * Clears the authentication token and resets current session.
   */
  logout(): void {
    this.pb.authStore.clear();
    this.currentUser.set(null);
  }

  /**
   * Utility helper to get file URL (for avatars, thumbnails, or videos).
   */
  getFileUrl(record: RecordModel, filename: string, queryParams?: { thumb?: string }): string {
    return this.pb.files.getURL(record, filename, queryParams);
  }
}
