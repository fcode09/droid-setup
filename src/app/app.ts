import { Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { Preferences } from './core/preferences';
import { Select } from './shared/select/select';
import { Connection } from './core/connection';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Select],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly router = inject(Router);
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  readonly currentView = computed(() =>
    this.currentUrl().startsWith('/settings') ? 'settings' : 'connect',
  );
  readonly p = inject(Preferences);
  readonly languages = [
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' },
  ];
  readonly connection = inject(Connection);
  constructor() {
    this.connection.start();
  }
}
