import { Routes } from '@angular/router';
import { Login } from './login/login';
import { Home } from './home/home';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'home', component: Home, canActivate: [authGuard] },
  { path: 'login', component: Login },
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: '**', redirectTo: 'home' },
];
