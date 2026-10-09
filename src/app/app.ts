import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatDrawer } from './chat-drawer/chat-drawer';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ChatDrawer],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('videoshare');
}
