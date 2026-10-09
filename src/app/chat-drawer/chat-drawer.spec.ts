import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChatDrawer } from './chat-drawer';
import { ChatService } from '../services/chat.service';
import { PocketBaseService } from '../services/pocketbase.service';

describe('ChatDrawer', () => {
  let component: ChatDrawer;
  let fixture: ComponentFixture<ChatDrawer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatDrawer],
      providers: [
        ChatService,
        PocketBaseService,
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatDrawer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create the chat drawer component', () => {
    expect(component).toBeTruthy();
  });
});
