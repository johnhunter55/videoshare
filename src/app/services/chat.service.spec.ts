import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChatService } from './chat.service';
import { PocketBaseService } from './pocketbase.service';

describe('ChatService', () => {
  let service: ChatService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ChatService,
        PocketBaseService,
        provideRouter([]),
      ],
    });
    service = TestBed.inject(ChatService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should have initial drawer closed and no active partner', () => {
    expect(service.isOpen()).toBe(false);
    expect(service.activePartner()).toBeNull();
    expect(service.unreadCount()).toBe(0);
    expect(service.conversations()).toEqual([]);
    expect(service.messages()).toEqual([]);
  });

  it('should toggle drawer state', () => {
    service.closeDrawer();
    expect(service.isOpen()).toBe(false);
  });

  it('should format relative date strings properly', () => {
    const nowIso = new Date().toISOString();
    expect(service.formatDate(nowIso)).toBe('Just now');
  });

  it('should format message time properly', () => {
    const date = new Date(2026, 9, 3, 14, 30);
    const timeStr = service.formatTime(date.toISOString());
    expect(timeStr).toContain(':30');
  });
});
