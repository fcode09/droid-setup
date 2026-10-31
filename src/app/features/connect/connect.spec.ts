import { TestBed } from '@angular/core/testing';
import { Connect } from './connect';
import { Connection } from '../../core/connection';
import { Desktop } from '../../core/desktop';

const device = {
  serial: 'TEST-USB',
  state: 'device',
  usb: true,
  model: 'Example',
  manufacturer: 'Samsung',
  androidVersion: '14',
  imei: null,
};
describe('Samsung identifiers', () => {
  it('shows only discovered identifiers and clears them after disconnect', async () => {
    const scan = vi
      .fn()
      .mockResolvedValue({ devices: [device], inspectedSerial: device.serial, adbVersion: 'test' });
    const readIdentifiers = vi.fn().mockResolvedValue({
      imei: '490154203237518',
      phoneNumber: '+51999123456',
      cleanupPending: false,
    });
    TestBed.configureTestingModule({
      providers: [{ provide: Desktop, useValue: { available: true, scan, readIdentifiers } }],
    });
    const connection = TestBed.inject(Connection);
    await connection.refresh();
    const fixture = TestBed.createComponent(Connect);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(Array.from(root.querySelectorAll('dt')).map((n) => n.textContent)).not.toContain('IMEI');
    expect(root.querySelector('.identifier-actions')).not.toBeNull();
    await fixture.componentInstance.readFromPhone();
    await fixture.whenStable();
    expect(fixture.componentInstance.fields().map((field) => field.key)).toContain('imei');
    expect(fixture.componentInstance.fields().map((field) => field.key)).toContain('phoneNumber');
    expect(root.querySelectorAll('app-copy-button').length).toBe(6);
    expect(root.querySelector('input')).toBeNull();
    scan.mockResolvedValue({ devices: [], inspectedSerial: null, adbVersion: 'test' });
    await connection.refresh();
    await fixture.whenStable();
    expect(fixture.componentInstance.screenIdentity()).toBeNull();
    expect(fixture.componentInstance.fields()).toEqual([]);
  });
  it('does not render a missing phone number when only IMEI was read', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Desktop,
          useValue: {
            available: true,
            scan: () =>
              Promise.resolve({
                devices: [device],
                inspectedSerial: device.serial,
                adbVersion: 'test',
              }),
            readIdentifiers: () =>
              Promise.resolve({
                imei: '490154203237518',
                phoneNumber: null,
                cleanupPending: false,
              }),
          },
        },
      ],
    });
    await TestBed.inject(Connection).refresh();
    const fixture = TestBed.createComponent(Connect);
    await fixture.whenStable();
    await fixture.componentInstance.readFromPhone();
    await fixture.whenStable();
    expect(fixture.componentInstance.fields().some((field) => field.key === 'imei')).toBe(true);
    expect(fixture.componentInstance.fields().some((field) => field.key === 'phoneNumber')).toBe(
      false,
    );
    expect(fixture.componentInstance.readFeedback()).toBe('partial');
  });
  it.each(['Xiaomi', 'Motorola', null])(
    'hides identifier actions for %s and blocks native reading',
    async (manufacturer) => {
      const readIdentifiers = vi.fn();
      TestBed.configureTestingModule({
        providers: [
          {
            provide: Desktop,
            useValue: {
              available: true,
              readIdentifiers,
              scan: () =>
                Promise.resolve({
                  devices: [{ ...device, manufacturer }],
                  inspectedSerial: device.serial,
                  adbVersion: 'test',
                }),
            },
          },
        ],
      });
      const connection = TestBed.inject(Connection);
      await connection.refresh();
      const fixture = TestBed.createComponent(Connect);
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('.identifier-actions')).toBeNull();
      expect(root.querySelector('dialog')).toBeNull();
      expect(
        fixture.componentInstance
          .fields()
          .some((field) => ['imei', 'phoneNumber'].includes(field.key)),
      ).toBe(false);
      await expect(connection.readIdentifiers()).rejects.toEqual({ code: 'unsupported-device' });
      expect(readIdentifiers).not.toHaveBeenCalled();
      expect(root.querySelectorAll('app-copy-button').length).toBe(manufacturer ? 4 : 3);
    },
  );
  it('distinguishes an outdated reader from a phone-screen error', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Desktop,
          useValue: {
            available: true,
            scan: () =>
              Promise.resolve({
                devices: [device],
                inspectedSerial: device.serial,
                adbVersion: 'test',
              }),
            readIdentifiers: () => Promise.reject({ code: 'missing-tools' }),
          },
        },
      ],
    });
    await TestBed.inject(Connection).refresh();
    const fixture = TestBed.createComponent(Connect);
    await fixture.whenStable();
    await fixture.componentInstance.readFromPhone();
    await fixture.whenStable();
    expect(fixture.componentInstance.readFeedback()).toBe('tools-error');
    expect(fixture.nativeElement.textContent).toContain(
      'The reader does not match this application version',
    );
  });
});
