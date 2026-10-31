import { TestBed } from '@angular/core/testing';
import { Settings } from './settings';
import { Desktop } from '../../core/desktop';

describe('Bundled licenses dialog', () => {
  // jsdom has no modal dialog methods. Real focus trapping/Escape is checked in the browser.
  beforeAll(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event('close'));
      },
    });
  });
  afterAll(() => {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  });

  it('opens immediately, loads notices, and closes without moving the page', async () => {
    let resolve!: (text: string) => void;
    const desktop = {
      available: false,
      notices: vi.fn(
        () =>
          new Promise<string>((r) => {
            resolve = r;
          }),
      ),
    };
    TestBed.configureTestingModule({ providers: [{ provide: Desktop, useValue: desktop }] });
    const fixture = TestBed.createComponent(Settings);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const dialog = root.querySelector('dialog')!;
    root.querySelector<HTMLButtonElement>('.licenses button')!.click();
    fixture.detectChanges();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[role="status"]')).not.toBeNull();
    resolve('Apache License\nVersion 2.0\nBundled dependency notices');
    await Promise.resolve();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(dialog.querySelector('pre')?.textContent).toContain('Apache License');
    dialog.querySelector<HTMLButtonElement>('button')!.click();
    expect(dialog.open).toBe(false);
    root.querySelector<HTMLButtonElement>('.licenses button')!.click();
    expect(dialog.open).toBe(true);
    expect(desktop.notices).toHaveBeenCalledTimes(1);
    dialog.close();
  });

  it('shows a visible error inside the dialog if notices cannot be read', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Desktop,
          useValue: { available: false, notices: () => Promise.reject({ code: 'missing-tools' }) },
        },
      ],
    });
    const fixture = TestBed.createComponent(Settings);
    await fixture.whenStable();
    await fixture.componentInstance.openNotices();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    fixture.nativeElement.querySelector('dialog').close();
  });
});
