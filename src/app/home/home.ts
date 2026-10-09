import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { RecordModel } from 'pocketbase';
import {
  CommentRecord,
  PocketBaseService,
  VideoRecord,
} from '../services/pocketbase.service';
import { UploadService } from '../services/upload.service';
import { ChatService } from '../services/chat.service';

export interface DisplayVideo {
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
  created: string;
  duration: string;
  thumbnailUrl: string;
  videoUrl: string;
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
  selector: 'app-home',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit, OnDestroy {
  protected readonly pbService = inject(PocketBaseService);
  protected readonly uploadService = inject(UploadService);
  protected readonly chatService = inject(ChatService);
  private readonly router = inject(Router);

  // Video and User Accounts State
  videos = signal<VideoRecord[]>([]);
  usersList = signal<RecordModel[]>([]);
  isLoading = signal(true);
  errorMessage = signal<string | null>(null);

  // Filters & Sorting
  searchQuery = signal('');
  selectedCategory = signal<string>('All');
  readonly categories = ['All', 'League of Legends', 'Valorant', 'Minecraft'];

  // User / Creator filter: 'all', 'me', or specific user.id
  selectedUserFilter = signal<string>('all');
  sortBy = signal<'newest' | 'oldest' | 'creator_asc'>('newest');

  // Upload Modal State
  isUploadOpen = signal(false);
  uploadError = signal<string | null>(null);
  uploadTitle = '';
  uploadDescription = '';
  uploadCategory: 'league of legends' | 'valorant' | 'minecraft' | 'other' = 'league of legends';
  uploadVisibility: 'public' | 'unlisted' | 'private' = 'public';
  selectedVideoFile: File | null = null;
  selectedFileName = signal<string | null>(null);

  // Edit Video Modal State
  videoToEdit = signal<DisplayVideo | null>(null);
  editTitle = '';
  editDescription = '';
  editCategory: 'league of legends' | 'valorant' | 'minecraft' | 'other' = 'league of legends';
  editVisibility: 'public' | 'unlisted' | 'private' = 'public';
  isSavingEdit = signal(false);
  editError = signal<string | null>(null);

  // Custom Delete Modal State
  videoToDelete = signal<DisplayVideo | null>(null);
  isDeleting = signal(false);
  deleteError = signal<string | null>(null);

  // Active Video Player Modal
  activeVideo = signal<DisplayVideo | null>(null);

  // Comments State (for Player Modal)
  comments = signal<DisplayComment[]>([]);
  isLoadingComments = signal(false);
  newCommentText = '';
  isSubmittingComment = signal(false);
  commentError = signal<string | null>(null);
  private unsubscribeComments?: () => void;

  // Copied Share Link Toast
  copiedToast = signal(false);

  // Combined, filtered, and sorted videos
  filteredVideos = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const category = this.selectedCategory();
    const userFilter = this.selectedUserFilter();
    const currentUserId = this.pbService.currentUser()?.id;
    const sortMode = this.sortBy();

    // Map real PocketBase videos into display items
    const displayList: DisplayVideo[] = this.videos().map((v) => {
      const userRecord = v.expand?.user;
      const creatorName =
        userRecord?.['name'] || userRecord?.['email'] || 'Community Player';
      const creatorId = (v.user as string) || userRecord?.id || '';

      const vidUrl = v.file ? this.pbService.getFileUrl(v, v.file) : '';

      // Title & category matching PocketBase schema
      const title = v.title || v['text'] || 'Untitled Video';
      const catRaw = (v.catigory || v['category'] || 'other').toLowerCase();
      const visibility = (v.visibility || 'public').toLowerCase();

      return {
        id: v.id,
        title,
        description: v.description || '',
        catigory: catRaw,
        categoryDisplay: this.formatGameName(catRaw),
        visibility,
        creatorName,
        creatorId,
        views: v.views || 0,
        timeAgo: this.formatDate(v['created']),
        created: v['created'],
        duration: v.duration || 'Video',
        thumbnailUrl: v['thumbnail'] ? this.pbService.getFileUrl(v, v['thumbnail']) : '',
        videoUrl: vidUrl,
        rawRecord: v,
      };
    });

    // Apply filtering
    let results = displayList.filter((video) => {
      // 1. Hide private videos from non-creators
      if (video.visibility === 'private' && video.creatorId !== currentUserId) {
        return false;
      }

      // 2. Specific Game Category filter
      if (category === 'League of Legends') {
        if (video.catigory !== 'league of legends') return false;
      } else if (category === 'Valorant') {
        if (video.catigory !== 'valorant') return false;
      } else if (category === 'Minecraft') {
        if (video.catigory !== 'minecraft') return false;
      }

      // 3. Creator / User Account filter
      if (userFilter === 'me') {
        if (!currentUserId || video.creatorId !== currentUserId) {
          return false;
        }
      } else if (userFilter !== 'all') {
        if (video.creatorId !== userFilter) {
          return false;
        }
      }

      // 4. Search query filter
      if (query) {
        const matchesTitle = video.title.toLowerCase().includes(query);
        const matchesDesc = video.description.toLowerCase().includes(query);
        const matchesCreator = video.creatorName.toLowerCase().includes(query);
        const matchesCategory = video.categoryDisplay.toLowerCase().includes(query);
        return matchesTitle || matchesDesc || matchesCreator || matchesCategory;
      }

      return true;
    });

    // Apply sorting
    return results.sort((a, b) => {
      if (sortMode === 'oldest') {
        return new Date(a.created).getTime() - new Date(b.created).getTime();
      }
      if (sortMode === 'creator_asc') {
        return a.creatorName.localeCompare(b.creatorName);
      }
      // default: newest
      return new Date(b.created).getTime() - new Date(a.created).getTime();
    });
  });

  // Selected user helper for display
  selectedUserObject = computed(() => {
    const filter = this.selectedUserFilter();
    if (filter === 'all') return null;
    if (filter === 'me') return this.pbService.currentUser();
    return this.usersList().find((u) => u.id === filter) || null;
  });

  async ngOnInit(): Promise<void> {
    // Automatically reload videos when a background upload succeeds
    this.uploadService.onUploadSuccess = () => {
      this.loadVideos();
    };

    await Promise.all([this.loadVideos(), this.loadUsers()]);
  }

  async loadVideos(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const items = await this.pbService.getVideos();
      this.videos.set(items);
    } catch (err: any) {
      console.warn('Could not load videos from PocketBase:', err);
      this.videos.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadUsers(): Promise<void> {
    try {
      const users = await this.pbService.getUsers();
      this.usersList.set(users);
    } catch (err: any) {
      if (!err?.isAbort) {
        console.warn('Could not load users list:', err);
      }
      this.usersList.set([]);
    }
  }

  setCategory(cat: string): void {
    this.selectedCategory.set(cat);
  }

  setUserFilter(userId: string): void {
    this.selectedUserFilter.set(userId);
  }

  setSortBy(sort: 'newest' | 'oldest' | 'creator_asc'): void {
    this.sortBy.set(sort);
  }

  clearUserFilter(): void {
    this.selectedUserFilter.set('all');
  }

  openUploadModal(): void {
    this.uploadError.set(null);
    this.isUploadOpen.set(true);
  }

  closeUploadModal(): void {
    this.isUploadOpen.set(false);
    this.resetUploadForm();
  }

  onVideoFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedVideoFile = input.files[0];
      this.selectedFileName.set(input.files[0].name);
    } else {
      this.selectedVideoFile = null;
      this.selectedFileName.set(null);
    }
  }

  handleUploadSubmit(event: Event): void {
    event.preventDefault();
    if (!this.uploadTitle.trim()) {
      this.uploadError.set('Video title is required.');
      return;
    }

    if (!this.selectedVideoFile) {
      this.uploadError.set('Please select a video file (.mp4, .webm, .mov) to upload.');
      return;
    }

    const currentUser = this.pbService.currentUser();
    if (!currentUser?.id) {
      this.uploadError.set('You must be signed in to upload a video.');
      return;
    }

    const formData = new FormData();
    formData.append('title', this.uploadTitle.trim());
    formData.append('catigory', this.uploadCategory);
    formData.append('visibility', this.uploadVisibility);
    formData.append('file', this.selectedVideoFile);
    formData.append('user', currentUser.id);

    if (this.uploadDescription.trim()) {
      formData.append('description', this.uploadDescription.trim());
    }

    const meta = {
      title: this.uploadTitle.trim(),
      category: this.formatGameName(this.uploadCategory),
      visibility: this.uploadVisibility,
    };

    // Close the modal immediately so the user can continue using the site freely!
    this.closeUploadModal();

    // Start upload in background
    this.uploadService.startUpload(formData, meta).catch((err) => {
      console.error('Background upload failed:', err);
    });
  }

  // Custom Delete Confirmation Modal Handlers
  promptDeleteVideo(video: DisplayVideo, event?: Event): void {
    event?.stopPropagation();
    this.deleteError.set(null);
    this.videoToDelete.set(video);
  }

  cancelDelete(): void {
    if (this.isDeleting()) return;
    this.videoToDelete.set(null);
    this.deleteError.set(null);
  }

  async confirmDelete(): Promise<void> {
    const video = this.videoToDelete();
    if (!video) return;

    this.isDeleting.set(true);
    this.deleteError.set(null);

    try {
      await this.pbService.deleteVideo(video.id);
      if (this.activeVideo()?.id === video.id) {
        this.closePlayer();
      }
      await this.loadVideos();
      this.videoToDelete.set(null);
    } catch (err: any) {
      this.deleteError.set(err?.message || 'Failed to delete video. Please try again.');
    } finally {
      this.isDeleting.set(false);
    }
  }

  handleDeleteVideo(video: DisplayVideo, event: Event): void {
    this.promptDeleteVideo(video, event);
  }

  // Edit Video Modal Handlers
  openEditModal(video: DisplayVideo, event?: Event): void {
    event?.stopPropagation();
    this.editTitle = video.title;
    this.editDescription = video.description || '';
    const cat = (video.catigory || 'valorant').toLowerCase();
    this.editCategory =
      cat === 'league of legends' || cat === 'valorant' || cat === 'minecraft' ? cat : 'other';
    const vis = (video.visibility || 'public').toLowerCase();
    this.editVisibility = vis === 'unlisted' || vis === 'private' ? vis : 'public';
    this.editError.set(null);
    this.videoToEdit.set(video);
  }

  closeEditModal(): void {
    if (this.isSavingEdit()) return;
    this.videoToEdit.set(null);
    this.editError.set(null);
  }

  async handleEditSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const video = this.videoToEdit();
    if (!video) return;

    if (!this.editTitle.trim()) {
      this.editError.set('Title cannot be empty.');
      return;
    }

    this.isSavingEdit.set(true);
    this.editError.set(null);

    try {
      const updatedData = {
        title: this.editTitle.trim(),
        description: this.editDescription.trim(),
        catigory: this.editCategory.toLowerCase(),
        visibility: this.editVisibility.toLowerCase(),
      };

      await this.pbService.updateVideo(video.id, updatedData);

      // If active video is open, update its title/cat/vis/desc
      if (this.activeVideo()?.id === video.id) {
        const cur = this.activeVideo()!;
        this.activeVideo.set({
          ...cur,
          title: updatedData.title,
          description: updatedData.description,
          catigory: updatedData.catigory,
          categoryDisplay: this.formatGameName(updatedData.catigory),
          visibility: updatedData.visibility,
        });
      }

      await this.loadVideos();
      this.videoToEdit.set(null);
    } catch (err: any) {
      this.editError.set(err?.message || 'Failed to update video. Please try again.');
    } finally {
      this.isSavingEdit.set(false);
    }
  }

  ngOnDestroy(): void {
    if (this.unsubscribeComments) {
      this.unsubscribeComments();
    }
  }

  openPlayer(video: DisplayVideo): void {
    this.activeVideo.set(video);
    // Asynchronously increment views
    this.pbService.incrementViews(video.id);
    // Load live comments
    this.loadComments(video.id);
  }

  closePlayer(): void {
    this.activeVideo.set(null);
    if (this.unsubscribeComments) {
      this.unsubscribeComments();
    }
  }

  copyShareLink(video: DisplayVideo, event?: Event): void {
    event?.stopPropagation();
    const url = `${window.location.origin}/watch/${video.id}`;
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

  downloadVideo(video: DisplayVideo, event?: Event): void {
    event?.stopPropagation();
    if (!video.videoUrl) return;

    const link = document.createElement('a');
    link.href = video.videoUrl;
    link.download = `${video.title.replace(/[^a-z0-9_-]/gi, '_')}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- Comments Logic for Modal Player ---

  async loadComments(videoId: string): Promise<void> {
    this.isLoadingComments.set(true);
    this.commentError.set(null);

    if (this.unsubscribeComments) {
      this.unsubscribeComments();
    }

    try {
      const rawComments = await this.pbService.getComments(videoId);
      this.mapAndSetComments(rawComments);

      this.unsubscribeComments = this.pbService.subscribeComments(
        videoId,
        async (action) => {
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
    const vid = this.activeVideo();
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
      this.commentError.set(err?.message || 'Could not post comment.');
    } finally {
      this.isSubmittingComment.set(false);
    }
  }

  async handleDeleteComment(commentId: string): Promise<void> {
    try {
      await this.pbService.deleteComment(commentId);
      const vid = this.activeVideo();
      if (vid) {
        const refreshed = await this.pbService.getComments(vid.id);
        this.mapAndSetComments(refreshed);
      }
    } catch (err: any) {
      console.error('Failed to delete comment:', err);
    }
  }

  // --- Direct Messages (DMs) Handlers ---

  openChat(userId: string, userName: string, event?: Event): void {
    event?.stopPropagation();
    this.chatService.openDrawer({ id: userId, name: userName });
  }

  handleLogout(): void {
    this.pbService.logout();
    this.router.navigate(['/login']);
  }

  formatGameName(cat: string): string {
    switch (cat.toLowerCase()) {
      case 'league of legends':
        return 'League of Legends';
      case 'valorant':
        return 'Valorant';
      case 'minecraft':
        return 'Minecraft';
      case 'other':
      default:
        return 'Other';
    }
  }

  private resetUploadForm(): void {
    this.uploadTitle = '';
    this.uploadDescription = '';
    this.uploadCategory = 'league of legends';
    this.uploadVisibility = 'public';
    this.selectedVideoFile = null;
    this.selectedFileName.set(null);
    this.uploadError.set(null);
  }

  private formatDate(dateStr: string): string {
    if (!dateStr) return 'Recently';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }
}
