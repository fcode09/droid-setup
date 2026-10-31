import { TestBed } from '@angular/core/testing';
import { Connection } from './connection';
import { Desktop } from './desktop';
import { Device, ScanResult } from './models';

const phone = (serial = 'USB01', state: Device['state'] = 'device', usb = true): Device => ({
  serial,
  state,
  usb,
  model: 'Galaxy A06',
  manufacturer: 'Samsung',
  androidVersion: '16',
  imei: null,
});
const result = (
  devices: Device[],
  inspectedSerial: string | null = devices[0]?.serial ?? null,
): ScanResult => ({ devices, inspectedSerial, adbVersion: '1.0.41' });

describe('USB connection state', () => {
  let connection: Connection;
  let desktop: { available: boolean; scan: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    desktop = { available: true, scan: vi.fn().mockResolvedValue(result([])) };
    TestBed.configureTestingModule({ providers: [{ provide: Desktop, useValue: desktop }] });
    connection = TestBed.inject(Connection);
  });
  afterEach(() => {
    connection.ngOnDestroy();
    vi.useRealTimers();
  });

  it('distinguishes waiting, authorized and disconnected devices', async () => {
    await connection.refresh();
    expect(connection.state()).toBe('waiting');
    desktop.scan.mockResolvedValue(result([phone()]));
    await connection.refresh();
    expect(connection.state()).toBe('connected');
    desktop.scan.mockResolvedValue(result([]));
    await connection.refresh();
    expect(connection.state()).toBe('waiting');
    expect(connection.selected()).toBeNull();
  });

  it.each(['unauthorized', 'offline', 'no-permissions', 'unsupported'] as const)(
    'shows %s without claiming a connection',
    async (state) => {
      desktop.scan.mockResolvedValue(result([phone('ONE', state, false)]));
      await connection.refresh();
      expect(connection.state()).toBe(state);
    },
  );

  it('does not treat an unverified transport as connected', async () => {
    desktop.scan.mockResolvedValue(result([phone('ONE', 'device', false)]));
    await connection.refresh();
    expect(connection.state()).toBe('unverified');
  });

  it.each(['timeout', 'missing-tools', 'error'])(
    'clears stale information after %s',
    async (code) => {
      desktop.scan.mockResolvedValueOnce(result([phone()]));
      await connection.refresh();
      desktop.scan.mockRejectedValue({ code });
      await connection.refresh();
      expect(connection.state()).toBe(code);
      expect(connection.devices()).toEqual([]);
      expect(connection.lastChecked()).toBeNull();
    },
  );

  it('requires a selection for multiple phones and inspects the chosen one', async () => {
    desktop.scan.mockResolvedValue(
      result([phone('ONE', 'device', false), phone('TWO', 'device', false)], null),
    );
    await connection.refresh();
    expect(connection.state()).toBe('choose');
    let resolve!: (value: ScanResult) => void;
    desktop.scan.mockImplementation(
      () =>
        new Promise<ScanResult>((r) => {
          resolve = r;
        }),
    );
    connection.select('TWO');
    expect(connection.state()).toBe('checking');
    expect(desktop.scan).toHaveBeenLastCalledWith('TWO');
    resolve(result([phone('ONE', 'device', false), phone('TWO')], 'TWO'));
    await Promise.resolve();
    await Promise.resolve();
    expect(connection.state()).toBe('connected');
  });

  it('serializes polling and does not update after disposal', async () => {
    let resolve!: (value: ScanResult) => void;
    desktop.scan.mockImplementation(
      () =>
        new Promise<ScanResult>((r) => {
          resolve = r;
        }),
    );
    const pending = connection.refresh();
    await connection.refresh();
    expect(desktop.scan).toHaveBeenCalledTimes(1);
    connection.ngOnDestroy();
    resolve(result([phone()]));
    await pending;
    expect(connection.devices()).toEqual([]);
  });

  it('keeps device selection responsive while a poll is running', async () => {
    desktop.scan.mockResolvedValueOnce(
      result([phone('ONE'), phone('TWO', 'device', false)], 'ONE'),
    );
    await connection.refresh();
    let resolve!: (value: ScanResult) => void;
    desktop.scan.mockImplementationOnce(
      () =>
        new Promise<ScanResult>((r) => {
          resolve = r;
        }),
    );
    desktop.scan.mockResolvedValue(result([phone('ONE', 'device', false), phone('TWO')], 'TWO'));
    const pending = connection.refresh();
    connection.select('TWO');
    resolve(result([phone('ONE')], 'ONE'));
    await pending;
    await Promise.resolve();
    expect(desktop.scan).toHaveBeenLastCalledWith('TWO');
    expect(connection.selectedSerial()).toBe('TWO');
    expect(connection.state()).toBe('connected');
  });

  it('polls every three seconds after completion and stops on destroy', async () => {
    vi.useFakeTimers();
    connection.start();
    await vi.advanceTimersByTimeAsync(6001);
    expect(desktop.scan).toHaveBeenCalledTimes(3);
    connection.ngOnDestroy();
    await vi.advanceTimersByTimeAsync(6000);
    expect(desktop.scan).toHaveBeenCalledTimes(3);
  });

  it('labels browser preview honestly without invoking native commands', async () => {
    desktop.available = false;
    connection.start();
    await connection.refresh();
    expect(connection.state()).toBe('preview');
    expect(desktop.scan).not.toHaveBeenCalled();
  });
});
