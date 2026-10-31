import { Routes } from '@angular/router';
export const routes: Routes = [
  {
    path: 'connect',
    loadComponent: () => import('./features/connect/connect').then((m) => m.Connect),
  },
  { path: 'reset', loadComponent: () => import('./features/reset/reset').then((m) => m.Reset) },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: 'connect' },
];
