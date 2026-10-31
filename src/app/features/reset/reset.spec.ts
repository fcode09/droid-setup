import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Reset } from './reset';
import { Connection } from '../../core/connection';
import { Desktop } from '../../core/desktop';
import { Device, ResetReview } from '../../core/models';

const phone: Device = {
  serial: 'ZTE-TEST',
  state: 'device',
  usb: true,
  manufacturer: 'ZTE',
  model: 'Test phone',
  androidVersion: '14',
  imei: null,
};
const clearReview = (): ResetReview => ({
  id: 'review-1',
  inspection: {
    serial: phone.serial,
    manufacturer: 'ZTE',
    model: 'Test phone',
    currentUser: 0,
    users: [{ id: 0, managed: false }],
    userUnlocked: true,
    accounts: { state: 'none-reported', complete: true, groups: [] },
    management: 'none-reported',
    restriction: 'none-reported',
    blockers: [],
    incompleteChecks: [],
  },
});

async function setup(review = clearReview()) {
  localStorage.clear();
  const desktop = {
    available: true,
    scan: vi
      .fn()
      .mockResolvedValue({ devices: [phone], inspectedSerial: phone.serial, adbVersion: 'test' }),
    inspectReset: vi.fn().mockResolvedValue(review),
    openResetAccounts: vi.fn().mockResolvedValue('accounts'),
    openResetSettings: vi.fn().mockResolvedValue('reset'),
  };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Desktop, useValue: desktop }],
  });
  const connection = TestBed.inject(Connection);
  await connection.refresh();
  const fixture = TestBed.createComponent(Reset);
  await fixture.whenStable();
  return { fixture, component: fixture.componentInstance, connection, desktop };
}
function acknowledge(component: Reset) {
  component.setAck('backupReviewed', true);
  component.setAck('accountsCheckedOnPhone', true);
  component.setAck('cloudSignOutChecked', true);
  component.setAck('authorized', true);
  component.setAck('dataLossUnderstood', true);
  component.setAck('serialConfirmation', phone.serial);
}

describe('Guided reset preparation', () => {
  it('inspects a ZTE only on explicit action and requires acknowledgments before handoff', async () => {
    const { fixture, component, desktop } = await setup();
    expect(desktop.inspectReset).not.toHaveBeenCalled();
    await component.checkDevice();
    await fixture.whenStable();
    expect(desktop.inspectReset).toHaveBeenCalledWith(phone.serial);
    expect(component.step()).toBe(2);
    expect(component.canOpenReset()).toBe(false);
    await component.openReset();
    expect(desktop.openResetSettings).not.toHaveBeenCalled();
    acknowledge(component);
    component.go(4);
    await fixture.whenStable();
    expect(component.canOpenReset()).toBe(true);
    await component.openReset();
    await fixture.whenStable();
    expect(desktop.openResetSettings).toHaveBeenCalledWith(
      phone.serial,
      'review-1',
      expect.objectContaining({ serialConfirmation: phone.serial, dataLossUnderstood: true }),
    );
    expect(component.handoff()).toBe('reset');
    expect(fixture.nativeElement.textContent).toContain('Continue on your phone');
    expect(fixture.nativeElement.textContent).toContain(
      'Opening Settings does not mean the reset has finished',
    );
  });
  it('never lets manual acknowledgment override detected accounts', async () => {
    const review = clearReview();
    review.inspection.accounts = {
      state: 'detected',
      complete: true,
      groups: [{ userId: 0, provider: 'google', accountType: 'com.google', count: 3 }],
    };
    review.inspection.blockers = ['accounts'];
    const { fixture, component, desktop } = await setup(review);
    await component.checkDevice();
    await fixture.whenStable();
    acknowledge(component);
    component.setAck('manualReviewAccepted', true);
    component.go(4);
    await component.openReset();
    expect(component.prepared()).toBe(false);
    expect(desktop.openResetSettings).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Google');
  });
  it('keeps unknown evidence visible and requires separate manual review', async () => {
    const review = clearReview();
    review.inspection.accounts = { state: 'unknown', complete: false, groups: [] };
    review.inspection.incompleteChecks = ['accounts'];
    const { fixture, component } = await setup(review);
    await component.checkDevice();
    await fixture.whenStable();
    acknowledge(component);
    expect(component.prepared()).toBe(false);
    component.setAck('manualReviewAccepted', true);
    expect(component.prepared()).toBe(true);
    expect(component.inspection()?.accounts.state).toBe('unknown');
  });
  it('clears account-opening success on a failed retry and invalidates prior confirmations', async () => {
    const { fixture, component, desktop } = await setup();
    await component.checkDevice();
    await fixture.whenStable();
    acknowledge(component);
    await component.openAccounts();
    await fixture.whenStable();
    expect(component.openedAccounts()).toBe('accounts');
    expect(component.needsRecheck()).toBe(true);
    expect(component.acks().authorized).toBe(false);
    desktop.openResetAccounts.mockRejectedValue({ code: 'reset-settings-unavailable' });
    await component.openAccounts();
    await fixture.whenStable();
    expect(component.openedAccounts()).toBeNull();
    expect(component.error()).toBe('resetSettingsError');
    expect(component.canOpenReset()).toBe(false);
  });
  it('invalidates the review when the selected phone disconnects', async () => {
    const { fixture, component, connection, desktop } = await setup();
    await component.checkDevice();
    await fixture.whenStable();
    acknowledge(component);
    desktop.scan.mockResolvedValue({ devices: [], inspectedSerial: null, adbVersion: 'test' });
    await connection.refresh();
    await fixture.whenStable();
    expect(component.review()).toBeNull();
    expect(component.step()).toBe(1);
    expect(component.acks().authorized).toBe(false);
  });
  it('reports unknown completion after disconnect following the handoff', async () => {
    const { fixture, component, connection, desktop } = await setup();
    await component.checkDevice();
    await fixture.whenStable();
    acknowledge(component);
    component.go(4);
    await component.openReset();
    await fixture.whenStable();
    desktop.scan.mockResolvedValue({ devices: [], inspectedSerial: null, adbVersion: 'test' });
    await connection.refresh();
    await fixture.whenStable();
    expect(component.handoff()).toBe('reset');
    expect(component.disconnected()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('reset status is unknown');
  });
  it('requires a new check after native review expiry and never retries reset navigation automatically', async () => {
    const { fixture, component, desktop } = await setup();
    await component.checkDevice();
    await fixture.whenStable();
    acknowledge(component);
    component.go(4);
    desktop.openResetSettings.mockRejectedValue({ code: 'reset-review-expired' });
    await component.openReset();
    await fixture.whenStable();
    expect(component.needsRecheck()).toBe(true);
    expect(component.acks().dataLossUnderstood).toBe(false);
    expect(desktop.openResetSettings).toHaveBeenCalledTimes(1);
  });
  it('gives a known profile blocker precedence over another unavailable check', async () => {
    const review = clearReview();
    review.inspection.currentUser = null;
    review.inspection.users!.push({ id: 10, managed: true });
    review.inspection.blockers = ['profiles'];
    review.inspection.incompleteChecks = ['current-user'];
    const { fixture, component } = await setup(review);
    await component.checkDevice();
    await fixture.whenStable();
    expect(component.profilesDetected()).toBe(true);
    expect(component.incomplete()).toBe(true);
    expect(component.prepared()).toBe(false);
  });
});
