import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Connection } from '../../core/connection';
import { Desktop } from '../../core/desktop';
import { Preferences } from '../../core/preferences';
import { ResetAcknowledgments, ResetReview, ResetSettingsPage } from '../../core/models';
import { MessageKey } from '../../core/messages';
import { Select } from '../../shared/select/select';

const emptyAcknowledgments = (): ResetAcknowledgments => ({
  serialConfirmation: '',
  authorized: false,
  backupReviewed: false,
  accountsCheckedOnPhone: false,
  cloudSignOutChecked: false,
  dataLossUnderstood: false,
  manualReviewAccepted: false,
});
const errorMessages: Record<string, MessageKey> = {
  'reset-blocked': 'resetBlockedError',
  'reset-review-expired': 'resetExpiredError',
  'reset-device-changed': 'resetChangedError',
  'reset-device-unavailable': 'resetChangedError',
  'reset-confirmation-required': 'resetConfirmationError',
  'reset-manual-review-required': 'resetManualRequired',
  'reset-settings-unavailable': 'resetSettingsError',
  timeout: 'resetTimeoutError',
};
const reasons: Record<string, MessageKey> = {
  accounts: 'resetBlockAccounts',
  profiles: 'resetBlockProfiles',
  'owner-user': 'resetBlockUser',
  'locked-user': 'resetBlockLocked',
  management: 'resetBlockManagement',
  restriction: 'resetBlockRestriction',
};

@Component({
  selector: 'app-reset',
  imports: [Select, RouterLink],
  templateUrl: './reset.html',
  styleUrl: './reset.scss',
})
export class Reset {
  readonly c = inject(Connection);
  readonly p = inject(Preferences);
  private readonly desktop = inject(Desktop);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('stepHeading');
  readonly step = signal(1);
  readonly review = signal<ResetReview | null>(null);
  readonly target = signal<string | null>(null);
  readonly busy = signal(false);
  readonly needsRecheck = signal(false);
  readonly error = signal<MessageKey | null>(null);
  readonly openedAccounts = signal<ResetSettingsPage | null>(null);
  readonly handoff = signal<ResetSettingsPage | null>(null);
  readonly disconnected = signal(false);
  private readonly openingReset = signal(false);
  readonly acks = signal(emptyAcknowledgments());
  readonly stepKeys: MessageKey[] = [
    'resetStepDevice',
    'resetStepAccounts',
    'resetStepPrepare',
    'resetStepReview',
  ];
  readonly options = computed(() =>
    this.c.devices().map((device) => ({
      value: device.serial,
      label: device.model ? `${device.model} · ${device.serial}` : device.serial,
    })),
  );
  readonly inspection = computed(() => this.review()?.inspection ?? null);
  readonly targetDevice = computed(() => this.inspection() ?? this.c.selected());
  readonly blockers = computed(() => this.inspection()?.blockers ?? []);
  readonly incomplete = computed(() => !!this.inspection()?.incompleteChecks.length);
  readonly profilesDetected = computed(() =>
    this.blockers().some((reason) => ['profiles', 'owner-user', 'locked-user'].includes(reason)),
  );
  readonly hasOtherAccounts = computed(
    () => this.inspection()?.accounts.groups.some((group) => group.provider === 'other') ?? false,
  );
  readonly available = computed(
    () => !this.busy() && !this.c.busy() && !this.c.actionBusy() && this.c.state() === 'connected',
  );
  readonly prepared = computed(
    () =>
      !!this.review() &&
      !this.needsRecheck() &&
      !this.blockers().length &&
      this.acks().backupReviewed &&
      this.acks().accountsCheckedOnPhone &&
      this.acks().cloudSignOutChecked &&
      (!this.incomplete() || this.acks().manualReviewAccepted),
  );
  readonly canOpenReset = computed(
    () =>
      this.available() &&
      this.prepared() &&
      this.acks().authorized &&
      this.acks().dataLossUnderstood &&
      this.acks().serialConfirmation === this.target() &&
      !this.handoff(),
  );
  readonly maker = computed(() => this.targetDevice()?.manufacturer?.toLowerCase() ?? '');
  readonly resetPath = computed<MessageKey>(() =>
    this.maker().includes('samsung')
      ? 'resetPathSamsung'
      : ['xiaomi', 'redmi', 'poco'].some((name) => this.maker().includes(name))
        ? 'resetPathXiaomi'
        : 'resetPathGeneric',
  );
  readonly cloudPath = computed<MessageKey>(() =>
    this.maker().includes('samsung')
      ? 'resetCloudSamsung'
      : ['xiaomi', 'redmi', 'poco'].some((name) => this.maker().includes(name))
        ? 'resetCloudXiaomi'
        : 'resetCloudGeneric',
  );

  constructor() {
    effect(() => {
      const selected = this.c.selectedSerial(),
        connected = this.c.state() === 'connected';
      untracked(() => {
        if (!this.target()) return;
        if (selected !== this.target() || !connected) {
          this.acks.set(emptyAcknowledgments());
          this.needsRecheck.set(true);
          if (this.handoff() || this.openingReset()) this.disconnected.set(true);
          else {
            this.review.set(null);
            this.target.set(null);
            this.step.set(1);
            this.error.set('resetChangedError');
          }
        }
      });
    });
    afterNextRender(() => this.heading()?.nativeElement.focus());
  }
  reason(key: string): MessageKey {
    return reasons[key] ?? 'resetManualRequired';
  }
  setAck(key: keyof ResetAcknowledgments, value: boolean | string): void {
    this.acks.update((current) => ({ ...current, [key]: value }));
  }
  go(step: number): void {
    if (this.busy() || (step > 1 && !this.review()) || (step === 4 && !this.prepared())) return;
    this.step.set(step);
    requestAnimationFrame(() => this.heading()?.nativeElement.focus());
  }
  async checkDevice(): Promise<void> {
    if (!this.available()) return;
    const serial = this.c.selectedSerial()!;
    this.target.set(serial);
    this.busy.set(true);
    this.error.set(null);
    this.acks.set(emptyAcknowledgments());
    this.handoff.set(null);
    this.disconnected.set(false);
    try {
      const review = await this.c.runDeviceAction(
        (value) => this.desktop.inspectReset(value),
        serial,
      );
      if (this.c.selectedSerial() !== serial) return;
      this.review.set(review);
      this.needsRecheck.set(false);
      this.openedAccounts.set(null);
      this.step.set(2);
      requestAnimationFrame(() => this.heading()?.nativeElement.focus());
    } catch (error) {
      this.review.set(null);
      this.error.set(this.message(error));
    } finally {
      this.busy.set(false);
    }
  }
  async openAccounts(): Promise<void> {
    const serial = this.target();
    if (!serial || !this.available()) return;
    this.busy.set(true);
    this.error.set(null);
    this.needsRecheck.set(true);
    this.acks.set(emptyAcknowledgments());
    this.openedAccounts.set(null);
    try {
      this.openedAccounts.set(
        await this.c.runDeviceAction((value) => this.desktop.openResetAccounts(value), serial),
      );
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.busy.set(false);
    }
  }
  async openReset(): Promise<void> {
    const review = this.review(),
      serial = this.target();
    if (!review || !serial || !this.canOpenReset()) return;
    this.busy.set(true);
    this.error.set(null);
    this.openingReset.set(true);
    try {
      this.handoff.set(
        await this.c.runDeviceAction(
          (value) => this.desktop.openResetSettings(value, review.id, this.acks()),
          serial,
        ),
      );
      this.needsRecheck.set(true);
    } catch (error) {
      this.needsRecheck.set(true);
      this.acks.set(emptyAcknowledgments());
      this.error.set(this.message(error));
    } finally {
      this.openingReset.set(false);
      this.busy.set(false);
    }
  }
  restart(): void {
    if (this.busy()) return;
    this.step.set(1);
    this.review.set(null);
    this.target.set(null);
    this.error.set(null);
    this.needsRecheck.set(false);
    this.handoff.set(null);
    this.openedAccounts.set(null);
    this.acks.set(emptyAcknowledgments());
    this.disconnected.set(false);
  }
  private message(error: unknown): MessageKey {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    return errorMessages[code] ?? 'resetCheckError';
  }
}
