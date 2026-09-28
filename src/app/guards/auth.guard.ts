import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PocketBaseService } from '../services/pocketbase.service';

export const authGuard: CanActivateFn = () => {
  const pbService = inject(PocketBaseService);
  const router = inject(Router);

  if (pbService.isLoggedIn()) {
    return true;
  }

  // Also check if valid token exists in storage synchronously
  if (pbService.pb.authStore.isValid) {
    return true;
  }

  return router.parseUrl('/login');
};
