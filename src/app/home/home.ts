import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PocketBaseService, VideoRecord } from '../services/pocketbase.service';

interface SampleVideo {
  id: string;
  title: string;
  description: string;
  category: string;
  creatorName: string;
  views: number;
  timeAgo: string;
  duration: string;
  thumbnailUrl: string;
  videoUrl?: string;
  isSample: boolean;
}

@Component({
  selector: 'app-home',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit {
  protected readonly pbService = inject(PocketBaseService);
  private readonly router = inject(Router);

  // Video State
  videos = signal<VideoRecord[]>([]);
  isLoading = signal(true);
  errorMessage = signal<string | null>(null);

  // Filters & Search
  searchQuery = signal('');
  selectedCategory = signal('All');
  readonly categories = ['All', 'Trending', 'Gaming', 'Music', 'Tech', 'Podcasts', 'My Videos'];

  // Upload Modal State
  isUploadOpen = signal(false);
  isUploading = signal(false);
  uploadError = signal<string | null>(null);
  uploadTitle = '';
  uploadDescription = '';
  uploadCategory = 'Tech';
  selectedVideoFile: File | null = null;
  selectedThumbFile: File | null = null;

  // Active Video Player Modal
  activeVideo = signal<any | null>(null);

  // Curated demo videos to show when the database has 0 uploads
  readonly sampleVideos: SampleVideo[] = [
    {
      id: 'demo-1',
      title: 'Building a Full-Stack Video Platform with Angular 22 & PocketBase',
      description: 'A deep dive into reactive signals, authentication, and PocketBase media storage.',
      category: 'Tech',
      creatorName: 'CodeMaster',
      views: 12450,
      timeAgo: '2 hours ago',
      duration: '18:42',
      thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
      isSample: true,
    },
    {
      id: 'demo-2',
      title: 'Synthwave Relaxing Beats - 24/7 Chill Radio to Code/Study to',
      description: 'Lofi & synthwave grooves for deep work sessions and late night hacking.',
      category: 'Music',
      creatorName: 'Neon Wave Music',
      views: 89300,
      timeAgo: '1 day ago',
      duration: '45:00',
      thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=800&q=80',
      isSample: true,
    },
    {
      id: 'demo-3',
      title: 'Top 10 Indie Games Coming Out This Fall You Must Play',
      description: 'Reviewing hidden gems, pixel art wonders, and upcoming indie game masterpieces.',
      category: 'Gaming',
      creatorName: 'Pixel Odyssey',
      views: 34100,
      timeAgo: '3 days ago',
      duration: '12:15',
      thumbnailUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=800&q=80',
      isSample: true,
    },
    {
      id: 'demo-4',
      title: 'Modern Architecture Tour: Minimalist Eco-Villa in Scandinavia',
      description: 'A walkthrough of a solar-powered concrete and wood sanctuary nestled in the fjords.',
      category: 'Trending',
      creatorName: 'Design Vault',
      views: 56200,
      timeAgo: '5 days ago',
      duration: '22:04',
      thumbnailUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
      isSample: true,
    },
  ];

  // Combined and filtered videos
  filteredVideos = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const category = this.selectedCategory();
    const user = this.pbService.currentUser();

    // Map real PocketBase videos into display items
    const realItems = this.videos().map((v) => {
      const creatorRecord = v.expand?.creator || v.expand?.user;
      const creatorName = creatorRecord?.['name'] || creatorRecord?.['email'] || 'Community Creator';
      const thumbUrl = v.thumbnail
        ? this.pbService.getFileUrl(v, v.thumbnail)
        : '';
      const vidUrl = v.videoFile
        ? this.pbService.getFileUrl(v, v.videoFile)
        : '';

      return {
        id: v.id,
        title: v.title || 'Untitled Video',
        description: v.description || '',
        category: v.category || 'General',
        creatorName,
        creatorId: v.creator || creatorRecord?.id,
        views: v.views || 0,
        timeAgo: this.formatDate(v['created']),
        duration: v.duration || '0:00',
        thumbnailUrl: thumbUrl,
        videoUrl: vidUrl,
        isSample: false,
        rawRecord: v,
      };
    });

    // If real videos exist, prioritize them. If none exist, include sample videos
    const allVideos = realItems.length > 0 ? realItems : this.sampleVideos;

    return allVideos.filter((video) => {
      // Category filter
      if (category === 'My Videos') {
        if ('creatorId' in video) {
          if (video.creatorId !== user?.id) return false;
        } else {
          return false;
        }
      } else if (category !== 'All') {
        if (video.category.toLowerCase() !== category.toLowerCase()) return false;
      }

      // Search query filter
      if (query) {
        const matchesTitle = video.title.toLowerCase().includes(query);
        const matchesDesc = video.description.toLowerCase().includes(query);
        const matchesCreator = video.creatorName.toLowerCase().includes(query);
        return matchesTitle || matchesDesc || matchesCreator;
      }

      return true;
    });
  });

  async ngOnInit(): Promise<void> {
    await this.loadVideos();
  }

  async loadVideos(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const items = await this.pbService.getVideos();
      this.videos.set(items);
    } catch (err: any) {
      console.warn('Could not load videos collection from PocketBase:', err);
      // Don't crash if collection is newly created or empty
      this.videos.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  setCategory(cat: string): void {
    this.selectedCategory.set(cat);
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
    }
  }

  onThumbFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedThumbFile = input.files[0];
    }
  }

  async handleUploadSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.uploadTitle.trim()) {
      this.uploadError.set('Video title is required.');
      return;
    }

    this.isUploading.set(true);
    this.uploadError.set(null);

    try {
      const formData = new FormData();
      formData.append('title', this.uploadTitle.trim());

      if (this.uploadDescription.trim()) {
        formData.append('description', this.uploadDescription.trim());
      }

      if (this.uploadCategory) {
        formData.append('category', this.uploadCategory);
      }

      if (this.selectedVideoFile) {
        formData.append('videoFile', this.selectedVideoFile);
      }

      if (this.selectedThumbFile) {
        formData.append('thumbnail', this.selectedThumbFile);
      }

      // Relate to current user
      const currentUser = this.pbService.currentUser();
      if (currentUser?.id) {
        formData.append('creator', currentUser.id);
        formData.append('user', currentUser.id);
      }

      await this.pbService.createVideo(formData);
      this.closeUploadModal();
      await this.loadVideos();
    } catch (err: any) {
      const message =
        err?.data?.message || err?.message || 'Failed to upload video to PocketBase. Check collection schema.';
      this.uploadError.set(message);
    } finally {
      this.isUploading.set(false);
    }
  }

  openPlayer(video: any): void {
    this.activeVideo.set(video);
  }

  closePlayer(): void {
    this.activeVideo.set(null);
  }

  handleLogout(): void {
    this.pbService.logout();
    this.router.navigate(['/login']);
  }

  private resetUploadForm(): void {
    this.uploadTitle = '';
    this.uploadDescription = '';
    this.uploadCategory = 'Tech';
    this.selectedVideoFile = null;
    this.selectedThumbFile = null;
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
