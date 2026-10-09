import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RecordModel } from 'pocketbase';
import {
  CommentRecord,
  PocketBaseService,
  VideoRecord,
} from '../services/pocketbase.service';
import { ChatService } from '../services/chat.service';

export interface WatchDisplayVideo {
  id: string;
  title: string;
  description: string;
  catigory: string;
  categoryDisplay: string;
  visibility: string;
  creatorName: string;
  creatorId: string;
  views: number;
  timeAgo: string;
  videoUrl: string;
  thumbnailUrl: string;
  rawRecord: VideoRecord;
}

export interface DisplayComment {
  id: string;
  content: string;
  timeAgo: string;
  userId: string;
  userName: string;
  canDelete: boolean;
}

@Component({
  selector: 'app-watch',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './watch.html',
  styleUrl: './watch.css',
})
export class Watch implements OnInit, OnDestroy {
  protected readonly pbService = inject(PocketBaseService);
  protected readonly chatService = inject(ChatService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // Video State
  video = signal<WatchDisplayVideo | null>(null);
  isLoading = signal(true);
  errorMessage = signal<string | null>(null);

  // More videos sidebar
  suggestedVideos = signal<WatchDisplayVideo[]>([]);

  // Comments State
  comments = signal<DisplayComment[]>([]);
  isLoadingComments = signal(true);
  newCommentText = '';
  isSubmittingComment = signal(false);
  commentError = signal<string | null>(null);
  private unsubscribeComments?: () => void;

  // Share & Copy Notification
  copiedToast = signal(false);

  // Edit Video State
  isEditing = signal(false);
  editTitle = '';
  editDescription = '';
  editCategory: 'league of legends' | 'valorant' | 'minecraft' | 'other' = 'league of legends';
  editVisibility: 'public' | 'unlisted' | 'private' = 'public';
  isSavingEdit = signal(false);
  editError = signal<string | null>(null);

  // Delete Confirmation State
  isDeletingConfirm = signal(false);
  isDeleting = signal(false);
  deleteError = signal<string | null>(null);

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const videoId = params.get('id');
      if (videoId) {
        this.loadVideo(videoId);
      } else {
        this.errorMessage.set('No video ID provided in URL.');
        this.isLoading.set(false);
      }
    });

    this.loadSuggestedVideos();
  }

  ngOnDestroy(): void {
    if (this.unsubscribeComments) {
      this.unsubscribeComments();
    }
  }

  async loadVideo(id: string): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const v = await this.pbService.getVideoById(id);

      // Increment view count asynchronously
      this.pbService.incrementViews(id);

      const userRecord = v.expand?.user;
      const creatorName =
        userRecord?.['name'] || userRecord?.['email'] || 'Community Creator';
      const creatorId = (v.user as string) || userRecord?.id || '';

      const vidUrl = v.file ? this.pbService.getFileUrl(v, v.file) : '';
      const thumbUrl = v['thumbnail'] ? this.pbService.getFileUrl(v, v['thumbnail']) : '';
      const catRaw = (v.catigory || v['category'] || 'other').toLowerCase();

      this.video.set({
        id: v.id,
        title: v.title || 'Untitled Video',
        description: v.description || '',
        catigory: catRaw,
        categoryDisplay: this.formatGameName(catRaw),
        visibility: (v.visibility || 'public').toLowerCase(),
        creatorName,
        creatorId,
        views: (v.views || 0) + 1,
        timeAgo: this.formatDate(v['created']),
        videoUrl: vidUrl,
        thumbnailUrl: thumbUrl,
        rawRecord: v,
      });

      this.isLoading.set(false);

      // Load comments for this video
      this.loadComments(id);
    } catch (err: any) {
      console.error('Error loading video on watch page:', err);
      this.errorMessage.set(
        'Video could not be found or is set to private. Make sure the link is correct.',
      );
      this.isLoading.set(false);
    }
  }

  async loadSuggestedVideos(): Promise<void> {
    try {
      const records = await this.pbService.getVideos();
      const currentId = this.video()?.id;
      const filtered = records
        .filter((r) => r.id !== currentId && (r.visibility || 'public') !== 'private')
        .slice(0, 8)
        .map((v) => {
          const userRecord = v.expand?.user;
          const creatorName =
            userRecord?.['name'] || userRecord?.['email'] || 'Community Creator';
          const catRaw = (v.catigory || v['category'] || 'other').toLowerCase();
          return {
            id: v.id,
            title: v.title || 'Untitled',
            description: v.description || '',
            catigory: catRaw,
            categoryDisplay: this.formatGameName(catRaw),
            visibility: (v.visibility || 'public').toLowerCase(),
            creatorName,
            creatorId: (v.user as string) || '',
            views: v.views || 0,
            timeAgo: this.formatDate(v['created']),
            videoUrl: v.file ? this.pbService.getFileUrl(v, v.file) : '',
            thumbnailUrl: v['thumbnail'] ? this.pbService.getFileUrl(v, v['thumbnail']) : '',
            rawRecord: v,
          };
        });
      this.suggestedVideos.set(filtered);
    } catch {
      // ignore suggested video errors
    }
  }

  // --- Comments Logic ---

  async loadComments(videoId: string): Promise<void> {
    this.isLoadingComments.set(true);
    this.commentError.set(null);

    if (this.unsubscribeComments) {
      this.unsubscribeComments();
    }

    try {
      const rawComments = await this.pbService.getComments(videoId);
      this.mapAndSetComments(rawComments);

      // Subscribe to real-time additions/deletions
      this.unsubscribeComments = this.pbService.subscribeComments(
        videoId,
        async (action, _record) => {
          if (action === 'create' || action === 'delete') {
            const refreshed = await this.pbService.getComments(videoId);
            this.mapAndSetComments(refreshed);
          }
        },
      );
    } catch {
      this.comments.set([]);
    } finally {
      this.isLoadingComments.set(false);
    }
  }

  private mapAndSetComments(list: CommentRecord[]): void {
    const currentUserId = this.pbService.currentUser()?.id;
    const mapped: DisplayComment[] = list.map((c) => {
      const user = c.expand?.relation2 || c.expand?.user;
      const userName = user?.['name'] || user?.['email'] || 'Player';
      const userId = (c.relation2 || c.user || '') as string;
      return {
        id: c.id,
        content: (c.text || c.content || '') as string,
        timeAgo: this.formatDate(c['created']),
        userId,
        userName,
        canDelete: !!currentUserId && userId === currentUserId,
      };
    });
    this.comments.set(mapped);
  }

  async handleAddComment(): Promise<void> {
    const text = this.newCommentText.trim();
    const vid = this.video();
    if (!text || !vid) return;

    if (!this.pbService.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }

    this.isSubmittingComment.set(true);
    this.commentError.set(null);

    try {
      await this.pbService.addComment(vid.id, text);
      this.newCommentText = '';
      const refreshed = await this.pbService.getComments(vid.id);
      this.mapAndSetComments(refreshed);
    } catch (err: any) {
      this.commentError.set(err?.message || 'Could not post comment. Please try again.');
    } finally {
      this.isSubmittingComment.set(false);
    }
  }

  async handleDeleteComment(commentId: string): Promise<void> {
    try {
      await this.pbService.deleteComment(commentId);
      const vid = this.video();
      if (vid) {
        const refreshed = await this.pbService.getComments(vid.id);
        this.mapAndSetComments(refreshed);
      }
    } catch (err: any) {
      console.error('Failed to delete comment:', err);
    }
  }

  // --- Share & Download Actions ---

  copyShareLink(): void {
    const url = window.location.href;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        this.copiedToast.set(true);
        setTimeout(() => this.copiedToast.set(false), 3000);
      })
      .catch(() => {
        prompt('Copy video link:', url);
      });
  }

  downloadVideo(): void {
    const vid = this.video();
    if (!vid?.videoUrl) return;

    const link = document.createElement('a');
    link.href = vid.videoUrl;
    link.download = `${vid.title.replace(/[^a-z0-9_-]/gi, '_')}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- Edit Video Handlers ---

  openEdit(): void {
    const v = this.video();
    if (!v) return;
    this.editTitle = v.title;
    this.editDescription = v.description;
    const cat = (v.catigory || 'valorant').toLowerCase();
    this.editCategory =
      cat === 'league of legends' || cat === 'valorant' || cat === 'minecraft' ? cat : 'other';
    const vis = (v.visibility || 'public').toLowerCase();
    this.editVisibility = vis === 'unlisted' || vis === 'private' ? vis : 'public';
    this.editError.set(null);
    this.isEditing.set(true);
  }

  closeEdit(): void {
    if (this.isSavingEdit()) return;
    this.isEditing.set(false);
    this.editError.set(null);
  }

  async handleSaveEdit(event: Event): Promise<void> {
    event.preventDefault();
    const vid = this.video();
    if (!vid) return;

    if (!this.editTitle.trim()) {
      this.editError.set('Title cannot be empty.');
      return;
    }

    this.isSavingEdit.set(true);
    this.editError.set(null);

    try {
      const data = {
        title: this.editTitle.trim(),
        description: this.editDescription.trim(),
        catigory: this.editCategory.toLowerCase(),
        visibility: this.editVisibility.toLowerCase(),
      };
      await this.pbService.updateVideo(vid.id, data);
      this.video.set({
        ...vid,
        title: data.title,
        description: data.description,
        catigory: data.catigory,
        categoryDisplay: this.formatGameName(data.catigory),
        visibility: data.visibility,
      });
      this.isEditing.set(false);
    } catch (err: any) {
      this.editError.set(err?.message || 'Failed to update video.');
    } finally {
      this.isSavingEdit.set(false);
    }
  }

  // --- Delete Video Handlers ---

  promptDelete(): void {
    this.deleteError.set(null);
    this.isDeletingConfirm.set(true);
  }

  cancelDelete(): void {
    if (this.isDeleting()) return;
    this.isDeletingConfirm.set(false);
    this.deleteError.set(null);
  }

  async confirmDelete(): Promise<void> {
    const vid = this.video();
    if (!vid) return;

    this.isDeleting.set(true);
    this.deleteError.set(null);

    try {
      await this.pbService.deleteVideo(vid.id);
      this.isDeletingConfirm.set(false);
      this.router.navigate(['/home']);
    } catch (err: any) {
      this.deleteError.set(err?.message || 'Failed to delete video.');
    } finally {
      this.isDeleting.set(false);
    }
  }

  // --- Direct Messages (DMs) ---

  openChat(): void {
    const vid = this.video();
    if (!vid) return;
    this.chatService.openDrawer({ id: vid.creatorId, name: vid.creatorName });
  }

  // --- Formatting Helpers ---

  formatGameName(cat: string): string {
    switch (cat.toLowerCase()) {
      case 'league of legends':
        return 'League of Legends';
      case 'valorant':
        return 'Valorant';
      case 'minecraft':
        return 'Minecraft';
      default:
        return 'Other';
    }
  }

  formatDate(dateStr?: string): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSecs = Math.floor(diffMs / 1000);
      const diffMins = Math.floor(diffSecs / 60);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffSecs < 60) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  }
}
