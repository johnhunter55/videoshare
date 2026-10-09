import { computed, Injectable, signal } from '@angular/core';
import PocketBase, { RecordAuthResponse, RecordListOptions, RecordModel } from 'pocketbase';

export interface VideoRecord extends RecordModel {
  title: string;
  description?: string;
  catigory?: 'league of legends' | 'valorant' | 'minecraft' | 'other' | string;
  file: string;
  user: string;
  views?: number;
  visibility?: 'public' | 'unlisted' | 'private' | string;
  json?: any;
  duration?: string;
  expand?: {
    user?: RecordModel;
    [key: string]: any;
  };
}

export interface CommentRecord extends RecordModel {
  relation?: string; // video ID in PocketBase
  relation2?: string; // user ID in PocketBase
  text?: string; // comment content
  video?: string;
  user?: string;
  content?: string;
  expand?: {
    relation2?: RecordModel;
    user?: RecordModel;
    [key: string]: any;
  };
}

export interface MessageRecord extends RecordModel {
  relation?: string; // sender User ID in PocketBase
  relation2?: string; // recipient User ID in PocketBase
  text?: string; // message text
  read?: boolean;
  sender?: string;
  recipient?: string;
  content?: string;
  expand?: {
    relation?: RecordModel;
    relation2?: RecordModel;
    sender?: RecordModel;
    recipient?: RecordModel;
    [key: string]: any;
  };
}

@Injectable({
  providedIn: 'root',
})
export class PocketBaseService {
  // PocketBase instance URL - customize as needed
  readonly pb = new PocketBase('http://100.118.206.60:3001/');

  // Reactive state for the current authenticated user
  readonly currentUser = signal<RecordModel | null>(this.pb.authStore.record);
  readonly isLoggedIn = computed(() => !!this.currentUser());

  // Cached users and in-flight promise to avoid redundant network requests and race conditions
  private cachedUsers: RecordModel[] | null = null;
  private usersInFlightPromise: Promise<RecordModel[]> | null = null;

  constructor() {
    // Disable SDK auto-cancellation globally to prevent cancelling concurrent queries
    this.pb.autoCancellation(false);

    // Keep signal synchronized with PocketBase AuthStore changes
    this.pb.authStore.onChange((_token, record) => {
      this.currentUser.set(record);
      if (!record) {
        this.cachedUsers = null;
      }
    });

    // Auto-refresh token on initial app load if a session is stored
    if (this.pb.authStore.isValid) {
      this.pb
        .collection('users')
        .authRefresh({ requestKey: null })
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
    this.cachedUsers = null;
  }

  /**
   * Fetch all registered users who have an account (cached and deduplicated).
   */
  async getUsers(forceRefresh = false): Promise<RecordModel[]> {
    if (!forceRefresh && this.cachedUsers && this.cachedUsers.length > 0) {
      return this.cachedUsers;
    }
    if (this.usersInFlightPromise) {
      return this.usersInFlightPromise;
    }

    this.usersInFlightPromise = (async () => {
      try {
        const users = await this.pb.collection('users').getFullList({
          sort: 'name,email',
          requestKey: null,
        });
        this.cachedUsers = users;
        return users;
      } catch (err: any) {
        if (!err?.isAbort) {
          console.warn('Could not fetch users list:', err);
        }
        return this.cachedUsers || [];
      } finally {
        this.usersInFlightPromise = null;
      }
    })();

    return this.usersInFlightPromise;
  }

  /**
   * Fetch a single user by ID.
   */
  async getUserById(id: string): Promise<RecordModel | null> {
    try {
      if (this.cachedUsers) {
        const found = this.cachedUsers.find((u) => u.id === id);
        if (found) return found;
      }
      return await this.pb.collection('users').getOne(id, { requestKey: null });
    } catch {
      return null;
    }
  }

  /**
   * Fetch list of videos from the PocketBase 'videos' collection.
   */
  async getVideos(options?: RecordListOptions): Promise<VideoRecord[]> {
    const response = await this.pb.collection('videos').getList<VideoRecord>(1, 100, {
      sort: '-created',
      expand: 'user,creator',
      requestKey: null,
      ...options,
    });
    return response.items;
  }

  /**
   * Create a new video entry (supports FormData for video & thumbnail files).
   */
  async createVideo(data: FormData | Record<string, any>): Promise<VideoRecord> {
    return await this.pb.collection('videos').create<VideoRecord>(data);
  }

  /**
   * Upload a video with realtime progress reporting using XMLHttpRequest.
   */
  createVideoWithProgress(
    formData: FormData,
    onProgress: (percent: number, loaded: number, total: number) => void,
  ): Promise<VideoRecord> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = this.pb.buildURL('/api/collections/videos/records');

      xhr.open('POST', url);

      if (this.pb.authStore.token) {
        xhr.setRequestHeader('Authorization', this.pb.authStore.token);
      }

      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (event.lengthComputable) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onProgress(percent, event.loaded, event.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data as VideoRecord);
          } catch {
            resolve(xhr.responseText as any);
          }
        } else {
          try {
            const errData = JSON.parse(xhr.responseText);
            reject(errData);
          } catch {
            reject(new Error(xhr.statusText || 'Upload failed'));
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error during video upload. Please check connection.'));
      };

      xhr.send(formData);
    });
  }

  /**
   * Update video record details (title, category, visibility, description).
   */
  async updateVideo(
    id: string,
    data: Partial<VideoRecord> | { [key: string]: any },
  ): Promise<VideoRecord> {
    return (await this.pb.collection('videos').update(id, data)) as unknown as VideoRecord;
  }

  /**
   * Delete a video by its ID.
   */
  async deleteVideo(id: string): Promise<boolean> {
    return await this.pb.collection('videos').delete(id);
  }

  /**
   * Fetch a single video by ID (with expanded user creator).
   */
  async getVideoById(id: string): Promise<VideoRecord> {
    return (await this.pb.collection('videos').getOne(id, {
      expand: 'user',
      requestKey: null,
    })) as unknown as VideoRecord;
  }

  /**
   * Increment video view count by 1.
   */
  async incrementViews(id: string): Promise<void> {
    try {
      const record = await this.pb.collection('videos').getOne<VideoRecord>(id, { requestKey: null });
      const currentViews = record.views || 0;
      await this.pb.collection('videos').update(id, { views: currentViews + 1 });
    } catch (e: any) {
      if (!e?.isAbort) {
        console.warn('Could not increment view count:', e);
      }
    }
  }

  // --- Comments Methods ---

  /**
   * Fetch comments for a specific video with expanded author user.
   */
  async getComments(videoId: string): Promise<CommentRecord[]> {
    try {
      return (await this.pb.collection('comments').getFullList({
        filter: `relation = "${videoId}"`,
        sort: '-created',
        expand: 'relation2,user',
        requestKey: null,
      })) as unknown as CommentRecord[];
    } catch (e: any) {
      if (!e?.isAbort) {
        console.warn('Could not fetch comments (check collection API rules):', e);
      }
      return [];
    }
  }

  /**
   * Post a new comment on a video.
   */
  async addComment(videoId: string, content: string): Promise<CommentRecord> {
    const currentUserId = this.currentUser()?.id;
    if (!currentUserId) throw new Error('You must be logged in to comment.');
    const commentText = content.trim();
    return (await this.pb.collection('comments').create(
      {
        relation: videoId,
        relation2: currentUserId,
        text: commentText,
        video: videoId,
        user: currentUserId,
        content: commentText,
      },
      { expand: 'relation2,user' },
    )) as unknown as CommentRecord;
  }

  /**
   * Delete a comment by ID.
   */
  async deleteComment(id: string): Promise<boolean> {
    return await this.pb.collection('comments').delete(id);
  }

  /**
   * Real-time subscription to comments on a video.
   */
  subscribeComments(
    videoId: string,
    callback: (action: string, record: CommentRecord) => void,
  ): () => void {
    if (typeof EventSource === 'undefined') {
      return () => {};
    }
    let active = true;
    this.pb
      .collection('comments')
      .subscribe<CommentRecord>('*', (e) => {
        if (!active) return;
        const vid = e.record.relation || e.record.video;
        if (vid === videoId) {
          callback(e.action, e.record);
        }
      })
      .catch((err) => console.warn('Real-time comments subscription notice:', err));

    return () => {
      active = false;
      this.pb.collection('comments').unsubscribe('*').catch(() => {});
    };
  }

  // --- Direct Messages (DMs) Methods ---

  /**
   * Fetch conversation history between current user and another user.
   */
  async getDirectMessages(otherUserId: string): Promise<MessageRecord[]> {
    const myId = this.currentUser()?.id;
    if (!myId) return [];
    try {
      return (await this.pb.collection('messages').getFullList({
        filter: `(relation = "${myId}" && relation2 = "${otherUserId}") || (relation = "${otherUserId}" && relation2 = "${myId}")`,
        sort: 'created',
        expand: 'relation,relation2',
        requestKey: null,
      })) as unknown as MessageRecord[];
    } catch (e: any) {
      if (!e?.isAbort) {
        console.warn('Could not fetch messages (check collection API rules):', e);
      }
      return [];
    }
  }

  /**
   * Send a direct message to another user.
   */
  async sendMessage(recipientId: string, content: string): Promise<MessageRecord> {
    const myId = this.currentUser()?.id;
    if (!myId) throw new Error('You must be logged in to send messages.');
    const textContent = content.trim();
    return (await this.pb.collection('messages').create(
      {
        relation: myId,
        relation2: recipientId,
        text: textContent,
        read: false,
        sender: myId,
        recipient: recipientId,
        content: textContent,
      },
      { expand: 'relation,relation2' },
    )) as unknown as MessageRecord;
  }

  /**
   * Fetch all messages sent or received by current user.
   */
  async getAllUserMessages(): Promise<MessageRecord[]> {
    const myId = this.currentUser()?.id;
    if (!myId) return [];
    try {
      return (await this.pb.collection('messages').getFullList({
        filter: `relation = "${myId}" || relation2 = "${myId}"`,
        sort: '-created',
        expand: 'relation,relation2',
        requestKey: null,
      })) as unknown as MessageRecord[];
    } catch (e: any) {
      if (!e?.isAbort) {
        console.warn('Could not fetch all user messages:', e);
      }
      return [];
    }
  }

  /**
   * Mark all unread messages from a specific sender as read.
   */
  async markMessagesAsRead(senderId: string): Promise<void> {
    const myId = this.currentUser()?.id;
    if (!myId) return;
    try {
      const unread = (await this.pb.collection('messages').getFullList({
        filter: `relation = "${senderId}" && relation2 = "${myId}" && read = false`,
        requestKey: null,
      })) as unknown as MessageRecord[];

      await Promise.all(
        unread.map((msg) => this.pb.collection('messages').update(msg.id, { read: true })),
      );
    } catch (e: any) {
      if (!e?.isAbort) {
        console.warn('Could not mark messages as read:', e);
      }
    }
  }

  /**
   * Real-time subscription for all message events.
   */
  subscribeAllMessages(
    callback: (action: string, record: MessageRecord) => void,
  ): () => void {
    if (typeof EventSource === 'undefined') {
      return () => {};
    }
    let active = true;
    this.pb
      .collection('messages')
      .subscribe<MessageRecord>('*', (e) => {
        if (!active) return;
        callback(e.action, e.record);
      })
      .catch((err) => console.warn('Real-time messages subscription notice:', err));

    return () => {
      active = false;
      this.pb.collection('messages').unsubscribe('*').catch(() => {});
    };
  }

  /**
   * Real-time subscription for 1-on-1 direct messages between current user and otherUserId.
   */
  subscribeMessages(
    otherUserId: string,
    callback: (action: string, record: MessageRecord) => void,
  ): () => void {
    if (typeof EventSource === 'undefined') {
      return () => {};
    }
    let active = true;
    const myId = this.currentUser()?.id;
    this.pb
      .collection('messages')
      .subscribe<MessageRecord>('*', (e) => {
        if (!active) return;
        const rec = e.record;
        const sender = rec.relation || rec.sender;
        const recipient = rec.relation2 || rec.recipient;
        if (
          (sender === myId && recipient === otherUserId) ||
          (sender === otherUserId && recipient === myId)
        ) {
          callback(e.action, rec);
        }
      })
      .catch((err) => console.warn('Real-time messages subscription notice:', err));

    return () => {
      active = false;
      this.pb.collection('messages').unsubscribe('*').catch(() => {});
    };
  }

  /**
   * Utility helper to get file URL (for avatars, thumbnails, or videos).
   */
  getFileUrl(record: RecordModel, filename: string, queryParams?: { thumb?: string }): string {
    return this.pb.files.getURL(record, filename, queryParams);
  }
}
