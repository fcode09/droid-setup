import { Component, OnDestroy, inject, input, signal } from '@angular/core';
import { Desktop } from '../../core/desktop';
import { Preferences } from '../../core/preferences';

@Component({
  selector: 'app-copy-button',
  templateUrl: './copy-button.html',
  styleUrl: './copy-button.scss',
})
export class CopyButton implements OnDestroy {
  readonly value = input.required<string>();
  readonly label = input.required<string>();
  readonly p = inject(Preferences);
  private readonly desktop = inject(Desktop);
  readonly state = signal<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  async copy(): Promise<void> {
    if (!this.value() || this.state() === 'copying') return;
    clearTimeout(this.timer);
    this.state.set('copying');
    try {
      await this.desktop.copy(this.value());
      if (this.disposed) return;
      this.state.set('copied');
    } catch {
      if (this.disposed) return;
      this.state.set('failed');
    }
    this.timer = setTimeout(() => this.state.set('idle'), 2500);
  }
  ngOnDestroy(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
