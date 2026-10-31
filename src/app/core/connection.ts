import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Desktop } from './desktop';
import { ConnectionState, Device, IdentifierResult } from './models';
import { MessageKey } from './messages';

const messages: Record<ConnectionState, [MessageKey, MessageKey]> = {
  checking: ['checkingTitle', 'checkingBody'],
  waiting: ['waitingTitle', 'waitingBody'],
  choose: ['chooseTitle', 'chooseBody'],
  connected: ['connectedTitle', 'connectedBody'],
  unauthorized: ['unauthorizedTitle', 'unauthorizedBody'],
  offline: ['offlineTitle', 'offlineBody'],
  'no-permissions': ['permissionsTitle', 'permissionsBody'],
  unverified: ['unverifiedTitle', 'unverifiedBody'],
  unsupported: ['unsupportedTitle', 'unsupportedBody'],
  'missing-tools': ['missingTitle', 'missingBody'],
  timeout: ['timeoutTitle', 'timeoutBody'],
  error: ['errorTitle', 'errorBody'],
  preview: ['previewTitle', 'previewBody'],
};

@Injectable({ providedIn: 'root' })
export class Connection implements OnDestroy {
  private readonly desktop = inject(Desktop);
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private disposed = false;
  private selectionRevision = 0;
  private readonly checkedSerial = signal<string | null>(null);
  readonly devices = signal<Device[]>([]);
  readonly selectedSerial = signal<string | null>(null);
  readonly busy = signal(false);
  readonly readingIdentifiers = signal(false);
  readonly actionBusy = signal(false);
  readonly error = signal<ConnectionState | null>(null);
  readonly lastChecked = signal<Date | null>(null);
  readonly adbVersion = signal<string | null>(null);
  readonly selected = computed(
    () => this.devices().find((d) => d.serial === this.selectedSerial()) ?? null,
  );
  readonly identifiersSupported = computed(
    () => this.selected()?.manufacturer?.trim().toLowerCase() === 'samsung',
  );
  readonly state = computed<ConnectionState>(() => {
    if (!this.desktop.available) return 'preview';
    if (this.error()) return this.error()!;
    if (!this.lastChecked()) return 'checking';
    if (!this.devices().length) return 'waiting';
    const device = this.selected();
    if (!device) return 'choose';
    if (device.state !== 'device') return device.state;
    if (this.checkedSerial() !== device.serial) return 'checking';
    return device.usb ? 'connected' : 'unverified';
  });
  readonly title = computed(() => messages[this.state()][0]);
  readonly description = computed(() => messages[this.state()][1]);

  start(): void {
    if (this.running || !this.desktop.available) return;
    this.running = true;
    void this.refresh();
  }

  select(serial: string): void {
    if (this.actionBusy() || !this.devices().some((d) => d.serial === serial)) return;
    this.selectionRevision++;
    this.selectedSerial.set(serial);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.busy() || this.actionBusy() || this.disposed || !this.desktop.available) return;
    clearTimeout(this.timer);
    this.busy.set(true);
    const revision = this.selectionRevision;
    try {
      const result = await this.desktop.scan(this.selectedSerial());
      if (this.disposed || revision !== this.selectionRevision) return;
      this.devices.set(result.devices);
      this.checkedSerial.set(result.inspectedSerial);
      this.adbVersion.set(result.adbVersion);
      if (!result.devices.some((d) => d.serial === this.selectedSerial())) {
        this.selectedSerial.set(result.devices.length === 1 ? result.devices[0].serial : null);
      }
      this.error.set(null);
      this.lastChecked.set(new Date());
    } catch (error: unknown) {
      if (this.disposed || revision !== this.selectionRevision) return;
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
      this.devices.set([]);
      this.lastChecked.set(null);
      this.error.set(
        code === 'missing-tools' ? 'missing-tools' : code === 'timeout' ? 'timeout' : 'error',
      );
    } finally {
      this.busy.set(false);
      if (!this.disposed && revision !== this.selectionRevision) void this.refresh();
      else if (this.running && !this.disposed)
        this.timer = setTimeout(() => void this.refresh(), 3000);
    }
  }

  async readIdentifiers(): Promise<IdentifierResult> {
    if (!this.identifiersSupported()) throw { code: 'unsupported-device' };
    this.readingIdentifiers.set(true);
    try {
      return await this.runDeviceAction((serial) => this.desktop.readIdentifiers(serial));
    } finally {
      this.readingIdentifiers.set(false);
    }
  }

  async runDeviceAction<T>(
    action: (serial: string) => Promise<T>,
    expectedSerial?: string,
  ): Promise<T> {
    const serial = this.selectedSerial();
    if (
      !serial ||
      (expectedSerial && expectedSerial !== serial) ||
      this.busy() ||
      this.actionBusy() ||
      this.state() !== 'connected'
    )
      throw { code: 'busy' };
    clearTimeout(this.timer);
    this.actionBusy.set(true);
    try {
      return await action(serial);
    } finally {
      this.actionBusy.set(false);
      if (!this.disposed) void this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.disposed = true;
    this.running = false;
    clearTimeout(this.timer);
  }
}
