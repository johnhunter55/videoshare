import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { RecordModel } from 'pocketbase';
import { PocketBaseService, VideoRecord } from '../services/pocketbase.service';
import { UploadService } from '../services/upload.service';

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

@Component({
  selector: 'app-home',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit {
  protected readonly pbService = inject(PocketBaseService);
  protected readonly uploadService = inject(UploadService);
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

  // Active Video Player Modal
  activeVideo = signal<DisplayVideo | null>(null);

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
        thumbnailUrl: '',
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
    } catch (err) {
      console.warn('Could not load users list:', err);
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

  async handleDeleteVideo(video: DisplayVideo, event: Event): Promise<void> {
    event.stopPropagation();
    if (!confirm(`Are you sure you want to delete "${video.title}"?`)) {
      return;
    }

    try {
      await this.pbService.deleteVideo(video.id);
      if (this.activeVideo()?.id === video.id) {
        this.closePlayer();
      }
      await this.loadVideos();
    } catch (err: any) {
      alert('Could not delete video: ' + (err?.message || 'Error occurred.'));
    }
  }

  openPlayer(video: DisplayVideo): void {
    this.activeVideo.set(video);
  }

  closePlayer(): void {
    this.activeVideo.set(null);
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
