import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RecordModel } from 'pocketbase';
import {
  MessageRecord,
  PocketBaseService,
} from './pocketbase.service';

export interface DisplayChatMessage {
  id: string;
  senderId: string;
  recipientId: string;
  senderName: string;
  content: string;
  timeAgo: string;
  formattedTime: string;
  isMe: boolean;
  read: boolean;
  created: string;
}

export interface ConversationThread {
  partnerId: string;
  partnerName: string;
  partnerAvatar?: string;
  lastMessage: string;
  timeAgo: string;
  unreadCount: number;
  lastDate: Date;
}

@Injectable({
  providedIn: 'root',
})
export class ChatService implements OnDestroy {
  private readonly pbService = inject(PocketBaseService);
  private readonly router = inject(Router);

  // UI state
  readonly isOpen = signal(false);
  readonly activePartner = signal<{ id: string; name: string } | null>(null);
  readonly isUserSearchOpen = signal(false);
  readonly userSearchQuery = signal('');

  // Data signals
  readonly conversations = signal<ConversationThread[]>([]);
  readonly messages = signal<DisplayChatMessage[]>([]);
  readonly unreadCount = signal<number>(0);
  readonly allUsers = signal<RecordModel[]>([]);

  // Loading / operation states
  readonly isLoadingConversations = signal(false);
  readonly isLoadingMessages = signal(false);
  readonly isSending = signal(false);
  readonly error = signal<string | null>(null);

  // Filtered users for "New Chat" search
  readonly filteredUsers = computed(() => {
    const query = this.userSearchQuery().trim().toLowerCase();
    const myId = this.pbService.currentUser()?.id;
    const users = this.allUsers().filter((u) => u.id !== myId);
    if (!query) return users;
    return users.filter((u) => {
      const name = (u['name'] || '').toLowerCase();
      const email = (u['email'] || '').toLowerCase();
      const username = (u['username'] || '').toLowerCase();
      return name.includes(query) || email.includes(query) || username.includes(query);
    });
  });

  private unsubscribeAll?: () => void;
  private userNamesCache = new Map<string, string>();

  constructor() {
    this.initRealtime();
    // Whenever auth state changes, update conversations
    if (this.pbService.isLoggedIn()) {
      this.loadAllUsers().then(() => this.loadConversations());
    }
  }

  ngOnDestroy(): void {
    if (this.unsubscribeAll) {
      this.unsubscribeAll();
    }
  }

  private initRealtime(): void {
    if (this.unsubscribeAll) {
      this.unsubscribeAll();
    }

    this.unsubscribeAll = this.pbService.subscribeAllMessages((action, record) => {
      const myId = this.pbService.currentUser()?.id;
      if (!myId) return;

      const senderId = record.relation || record.sender || '';
      const recipientId = record.relation2 || record.recipient || '';

      // Only handle if message involves current user
      if (senderId !== myId && recipientId !== myId) return;

      const partner = this.activePartner();
      const isCurrentConversation =
        partner &&
        ((senderId === myId && recipientId === partner.id) ||
          (senderId === partner.id && recipientId === myId));

      if (isCurrentConversation) {
        // If chatting with this person right now, reload active messages
        this.loadMessages(partner.id, false);
      }

      // Always refresh conversations list and unread badge
      this.loadConversations(false);
    });
  }

  /**
   * Open the chat drawer. If partner is passed, opens chat directly with them.
   */
  async openDrawer(partner?: { id: string; name: string }): Promise<void> {
    if (!this.pbService.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }

    this.isOpen.set(true);

    if (partner) {
      this.activePartner.set(partner);
      this.isUserSearchOpen.set(false);
      await this.loadMessages(partner.id);
    } else {
      if (!this.activePartner()) {
        await this.loadConversations();
      }
    }
  }

  closeDrawer(): void {
    this.isOpen.set(false);
    this.isUserSearchOpen.set(false);
  }

  toggleDrawer(): void {
    if (this.isOpen()) {
      this.closeDrawer();
    } else {
      this.openDrawer();
    }
  }

  async selectPartner(partner: { id: string; name: string }): Promise<void> {
    this.activePartner.set(partner);
    this.isUserSearchOpen.set(false);
    await this.loadMessages(partner.id);
  }

  backToConversations(): void {
    this.activePartner.set(null);
    this.isUserSearchOpen.set(false);
    this.userSearchQuery.set('');
    this.loadConversations();
  }

  startNewChat(): void {
    this.isUserSearchOpen.set(true);
    this.userSearchQuery.set('');
    this.loadAllUsers();
  }

  cancelNewChat(): void {
    this.isUserSearchOpen.set(false);
    this.userSearchQuery.set('');
  }

  /**
   * Load all users for name lookup and start chat search.
   */
  async loadAllUsers(): Promise<void> {
    try {
      const users = await this.pbService.getUsers();
      this.allUsers.set(users);
      users.forEach((u) => {
        const name = u['name'] || u['username'] || u['email'] || 'Community User';
        this.userNamesCache.set(u.id, name);
      });
    } catch {
      // Ignore if unauthenticated
    }
  }

  /**
   * Fetch all conversation threads for current user.
   */
  async loadConversations(showLoading = true): Promise<void> {
    const myId = this.pbService.currentUser()?.id;
    if (!myId) {
      this.conversations.set([]);
      this.unreadCount.set(0);
      return;
    }

    if (showLoading) {
      this.isLoadingConversations.set(true);
    }

    try {
      if (this.allUsers().length === 0) {
        await this.loadAllUsers();
      }

      const rawMessages = await this.pbService.getAllUserMessages();
      const threadsMap = new Map<string, {
        partnerId: string;
        partnerName: string;
        lastMessage: string;
        unreadCount: number;
        lastDate: Date;
      }>();

      for (const msg of rawMessages) {
        const senderId = msg.relation || msg.sender || '';
        const recipientId = msg.relation2 || msg.recipient || '';
        const partnerId = senderId === myId ? recipientId : senderId;
        if (!partnerId) continue;

        const isUnreadForMe = recipientId === myId && !msg.read;
        const msgDate = new Date(msg['created']);

        // Try getting partner name from expanded record first, then cache
        const expandPartner = senderId === myId
          ? (msg.expand?.relation2 || msg.expand?.recipient)
          : (msg.expand?.relation || msg.expand?.sender);

        const partnerName =
          expandPartner?.['name'] ||
          expandPartner?.['username'] ||
          expandPartner?.['email'] ||
          this.userNamesCache.get(partnerId) ||
          'Community User';

        if (!this.userNamesCache.has(partnerId)) {
          this.userNamesCache.set(partnerId, partnerName);
        }

        const content = msg.text || msg.content || '';
        const preview = senderId === myId ? `You: ${content}` : content;

        const existing = threadsMap.get(partnerId);
        if (!existing) {
          threadsMap.set(partnerId, {
            partnerId,
            partnerName,
            lastMessage: preview,
            unreadCount: isUnreadForMe ? 1 : 0,
            lastDate: msgDate,
          });
        } else {
          if (isUnreadForMe) {
            existing.unreadCount += 1;
          }
          if (msgDate > existing.lastDate) {
            existing.lastDate = msgDate;
            existing.lastMessage = preview;
          }
        }
      }

      const threadList: ConversationThread[] = Array.from(threadsMap.values())
        .sort((a, b) => b.lastDate.getTime() - a.lastDate.getTime())
        .map((t) => ({
          ...t,
          timeAgo: this.formatDate(t.lastDate.toISOString()),
        }));

      this.conversations.set(threadList);

      // Calculate total unread messages
      const totalUnread = threadList.reduce((sum, t) => sum + t.unreadCount, 0);
      this.unreadCount.set(totalUnread);
    } catch (err: any) {
      console.warn('Could not load conversations:', err);
    } finally {
      if (showLoading) {
        this.isLoadingConversations.set(false);
      }
    }
  }

  /**
   * Load 1-on-1 direct messages with a specific partner.
   */
  async loadMessages(partnerId: string, showLoading = true): Promise<void> {
    const myId = this.pbService.currentUser()?.id;
    if (!myId) return;

    if (showLoading) {
      this.isLoadingMessages.set(true);
    }

    try {
      const records = await this.pbService.getDirectMessages(partnerId);
      const mapped: DisplayChatMessage[] = records.map((m) => {
        const senderId = m.relation || m.sender || '';
        const recipientId = m.relation2 || m.recipient || '';
        const isMe = senderId === myId;

        const expandSender = m.expand?.relation || m.expand?.sender;
        const senderName = isMe
          ? 'You'
          : expandSender?.['name'] ||
            expandSender?.['username'] ||
            expandSender?.['email'] ||
            this.activePartner()?.name ||
            this.userNamesCache.get(senderId) ||
            'User';

        return {
          id: m.id,
          senderId,
          recipientId,
          senderName,
          content: m.text || m.content || '',
          timeAgo: this.formatDate(m['created']),
          formattedTime: this.formatTime(m['created']),
          isMe,
          read: !!m.read,
          created: m['created'],
        };
      });

      this.messages.set(mapped);

      // Mark incoming messages as read
      await this.pbService.markMessagesAsRead(partnerId);

      // Decrement unread count for this thread
      this.conversations.update((list) =>
        list.map((t) => (t.partnerId === partnerId ? { ...t, unreadCount: 0 } : t)),
      );
      const totalUnread = this.conversations().reduce((sum, t) => sum + t.unreadCount, 0);
      this.unreadCount.set(totalUnread);
    } catch (err: any) {
      console.warn('Could not load messages:', err);
      this.messages.set([]);
    } finally {
      if (showLoading) {
        this.isLoadingMessages.set(false);
      }
    }
  }

  /**
   * Send a direct message to current active partner.
   */
  async sendMessage(content: string): Promise<boolean> {
    const text = content.trim();
    const partner = this.activePartner();
    if (!text || !partner) return false;

    this.isSending.set(true);
    this.error.set(null);

    try {
      await this.pbService.sendMessage(partner.id, text);
      await this.loadMessages(partner.id, false);
      await this.loadConversations(false);
      return true;
    } catch (err: any) {
      console.error('Failed to send message:', err);
      this.error.set(err?.message || 'Failed to send message.');
      return false;
    } finally {
      this.isSending.set(false);
    }
  }

  // --- Formatting Helpers ---

  formatDate(dateStr: string): string {
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
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  formatTime(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }
}
