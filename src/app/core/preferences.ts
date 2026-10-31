import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { english, spanish, MessageKey } from './messages';
import { Language } from './models';

@Injectable({ providedIn: 'root' })
export class Preferences {
  private readonly document = inject(DOCUMENT);
  readonly language = signal<Language>('en');
  readonly storageError = signal(false);
  readonly sidebarCollapsed = signal(false);

  constructor() {
    try {
      if (localStorage.getItem('droid-setup.language') === 'es') this.language.set('es');
      this.sidebarCollapsed.set(localStorage.getItem('droid-setup.sidebar-collapsed') === 'true');
    } catch {
      this.storageError.set(true);
    }
    this.document.documentElement.lang = this.language();
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((value) => !value);
    try {
      localStorage.setItem('droid-setup.sidebar-collapsed', String(this.sidebarCollapsed()));
      this.storageError.set(false);
    } catch {
      this.storageError.set(true);
    }
  }

  t(key: MessageKey): string {
    return (this.language() === 'es' ? spanish : english)[key];
  }

  setLanguage(language: string): void {
    if (language !== 'en' && language !== 'es') return;
    this.language.set(language);
    this.document.documentElement.lang = language;
    try {
      localStorage.setItem('droid-setup.language', language);
      this.storageError.set(false);
    } catch {
      this.storageError.set(true);
    }
  }
}
