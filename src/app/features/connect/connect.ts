import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Connection } from '../../core/connection';
import { Preferences } from '../../core/preferences';
import { MessageKey } from '../../core/messages';
import { CopyButton } from '../../shared/copy-button/copy-button';
import { Select } from '../../shared/select/select';

@Component({
  selector: 'app-connect',
  imports: [DatePipe, Select, CopyButton],
  templateUrl: './connect.html',
  styleUrl: './connect.scss',
})
export class Connect {
  private readonly destroyRef = inject(DestroyRef);
  private readonly region = viewChild.required<ElementRef<HTMLElement>>('scrollRegion');
  readonly c = inject(Connection);
  readonly p = inject(Preferences);
  readonly deviceOptions = computed(() =>
    this.c.devices().map((device) => ({
      value: device.serial,
      label: `${device.model || this.p.t('unknown')} · ${device.serial}`,
    })),
  );
  readonly screenIdentity = signal<{ serial: string; imei: string; phoneNumber: string } | null>(
    null,
  );
  readonly readFeedback = signal<
    'none' | 'complete' | 'partial' | 'unavailable' | 'error' | 'cleanup' | 'tools-error'
  >('none');
  readonly fields = computed(() => {
    const device = this.c.selected();
    if (!device || this.c.state() !== 'connected') return [];
    const fields: { key: MessageKey; value: string | null; fromScreen?: boolean }[] = [
      { key: 'manufacturer', value: device.manufacturer },
      { key: 'model', value: device.model },
      { key: 'androidVersion', value: device.androidVersion },
      { key: 'serial', value: device.serial },
    ];
    if (this.c.identifiersSupported()) {
      const screen = this.screenIdentity()?.serial === device.serial ? this.screenIdentity() : null;
      fields.push({ key: 'imei', value: screen?.imei || device.imei, fromScreen: !!screen?.imei });
      fields.push({
        key: 'phoneNumber',
        value: screen?.phoneNumber || null,
        fromScreen: !!screen?.phoneNumber,
      });
    }
    return fields
      .filter((field) => !!field.value)
      .map((field) => ({ ...field, value: field.value! }));
  });
  async readFromPhone(): Promise<void> {
    const serial = this.c.selectedSerial();
    if (!serial || !this.c.identifiersSupported()) return;
    this.readFeedback.set('none');
    try {
      const result = await this.c.readIdentifiers();
      if (this.c.selectedSerial() !== serial) return;
      this.screenIdentity.set({
        serial,
        imei: result.imei || '',
        phoneNumber: result.phoneNumber || '',
      });
      this.readFeedback.set(
        result.cleanupPending
          ? 'cleanup'
          : result.imei && result.phoneNumber
            ? 'complete'
            : result.imei || result.phoneNumber
              ? 'partial'
              : 'unavailable',
      );
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
      this.readFeedback.set(
        code === 'cleanup-pending' ? 'cleanup' : code === 'missing-tools' ? 'tools-error' : 'error',
      );
    }
  }
  constructor() {
    effect(() => {
      const serial = this.c.selectedSerial(),
        state = this.c.state(),
        supported = this.c.identifiersSupported();
      untracked(() => {
        if (state !== 'connected' || !supported || this.screenIdentity()?.serial !== serial)
          this.screenIdentity.set(null);
      });
    });
    afterNextRender(() => {
      const region = this.region().nativeElement;
      region.scrollTop = 0;
      if (typeof ResizeObserver === 'undefined') return;
      let previousWidth = region.clientWidth;
      const observer = new ResizeObserver(() => {
        const width = region.clientWidth;
        if (Math.abs(width - previousWidth) > 40) region.scrollTop = 0;
        previousWidth = width;
      });
      observer.observe(region);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
