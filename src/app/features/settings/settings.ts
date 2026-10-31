import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Preferences } from '../../core/preferences';
import { Connection } from '../../core/connection';
import { Select } from '../../shared/select/select';
import { Desktop } from '../../core/desktop';

@Component({
  selector: 'app-settings',
  imports: [Select],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  readonly p = inject(Preferences);
  readonly languages = [
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' },
  ];
  readonly c = inject(Connection);
  private readonly desktop = inject(Desktop);
  readonly notices = signal<string | null>(null);
  readonly noticeError = signal(false);
  readonly loading = signal(false);
  readonly licenseDialog = viewChild.required<ElementRef<HTMLDialogElement>>('licenseDialog');
  async openNotices(): Promise<void> {
    const dialog = this.licenseDialog().nativeElement;
    if (!dialog.open) dialog.showModal();
    if (this.notices() || this.loading()) return;
    this.loading.set(true);
    this.noticeError.set(false);
    try {
      this.notices.set(await this.desktop.notices());
    } catch {
      this.noticeError.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
