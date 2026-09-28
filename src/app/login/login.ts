import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PocketBaseService } from '../services/pocketbase.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  protected readonly pbService = inject(PocketBaseService);
  private readonly router = inject(Router);

  // UI state
  isSignUp = signal(false);
  isLoading = signal(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  // Form inputs
  email = '';
  password = '';
  passwordConfirm = '';
  name = '';

  constructor() {
    // If user is already authenticated, redirect to /home immediately
    effect(() => {
      if (this.pbService.isLoggedIn()) {
        this.router.navigate(['/home']);
      }
    });
  }

  toggleMode(): void {
    this.isSignUp.update((val) => !val);
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }

  setMode(signUp: boolean): void {
    if (this.isSignUp() !== signUp) {
      this.isSignUp.set(signUp);
      this.errorMessage.set(null);
      this.successMessage.set(null);
    }
  }

  async handleEmailAuth(event: Event): Promise<void> {
    event.preventDefault();
    this.errorMessage.set(null);
    this.successMessage.set(null);

    if (!this.email || !this.password) {
      this.errorMessage.set('Please fill in all required fields.');
      return;
    }

    if (this.isSignUp()) {
      if (this.password !== this.passwordConfirm) {
        this.errorMessage.set('Passwords do not match.');
        return;
      }
      if (this.password.length < 8) {
        this.errorMessage.set('Password must be at least 8 characters.');
        return;
      }
    }

    this.isLoading.set(true);

    try {
      if (this.isSignUp()) {
        await this.pbService.signUpWithEmail({
          email: this.email,
          password: this.password,
          passwordConfirm: this.passwordConfirm,
          name: this.name.trim() || undefined,
        });
        this.successMessage.set('Account created and signed in successfully!');
      } else {
        await this.pbService.loginWithEmail(this.email, this.password);
      }
      this.resetForm();
      await this.router.navigate(['/home']);
    } catch (err: any) {
      this.errorMessage.set(this.formatErrorMessage(err));
    } finally {
      this.isLoading.set(false);
    }
  }

  async handleGoogleAuth(): Promise<void> {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.isLoading.set(true);

    try {
      await this.pbService.loginWithGoogle();
      this.resetForm();
      await this.router.navigate(['/home']);
    } catch (err: any) {
      this.errorMessage.set(this.formatErrorMessage(err));
    } finally {
      this.isLoading.set(false);
    }
  }

  handleLogout(): void {
    this.pbService.logout();
    this.successMessage.set('Logged out successfully.');
  }

  private resetForm(): void {
    this.email = '';
    this.password = '';
    this.passwordConfirm = '';
    this.name = '';
  }

  private formatErrorMessage(err: any): string {
    if (typeof err === 'string') return err;
    if (err?.data?.message) return err.data.message;
    if (err?.message) return err.message;
    return 'An unexpected error occurred. Please try again.';
  }
}
