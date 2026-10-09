import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  Component,
  ElementRef,
  inject,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RecordModel } from 'pocketbase';
import { ChatService, ConversationThread } from '../services/chat.service';
import { PocketBaseService } from '../services/pocketbase.service';

@Component({
  selector: 'app-chat-drawer',
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-drawer.html',
  styleUrl: './chat-drawer.css',
})
export class ChatDrawer implements AfterViewChecked {
  protected readonly chatService = inject(ChatService);
  protected readonly pbService = inject(PocketBaseService);

  @ViewChild('messagesContainer') private messagesContainer?: ElementRef<HTMLDivElement>;

  newMessageText = '';
  private shouldScrollToBottom = false;
  private lastMessageCount = 0;

  ngAfterViewChecked(): void {
    const currentCount = this.chatService.messages().length;
    if (this.shouldScrollToBottom || currentCount !== this.lastMessageCount) {
      this.scrollToBottom();
      this.lastMessageCount = currentCount;
      this.shouldScrollToBottom = false;
    }
  }

  scrollToBottom(): void {
    if (this.messagesContainer?.nativeElement) {
      const el = this.messagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  async handleSendMessage(): Promise<void> {
    const text = this.newMessageText.trim();
    if (!text || this.chatService.isSending()) return;

    this.newMessageText = '';
    this.shouldScrollToBottom = true;
    const success = await this.chatService.sendMessage(text);
    if (!success) {
      this.newMessageText = text; // restore on error
    } else {
      setTimeout(() => this.scrollToBottom(), 50);
    }
  }

  onInputKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.handleSendMessage();
    }
  }

  onSelectConversation(thread: ConversationThread): void {
    this.chatService.selectPartner({
      id: thread.partnerId,
      name: thread.partnerName,
    });
    this.shouldScrollToBottom = true;
  }

  onSelectUser(user: RecordModel): void {
    const name = user['name'] || user['username'] || user['email'] || 'Community User';
    this.chatService.selectPartner({
      id: user.id,
      name,
    });
    this.shouldScrollToBottom = true;
  }
}
