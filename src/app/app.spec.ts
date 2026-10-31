import { By } from '@angular/platform-browser';
import { Select } from './shared/select/select';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { Desktop } from './core/desktop';
import { Preferences } from './core/preferences';

describe('Desktop interface', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), { provide: Desktop, useValue: { available: false } }],
    });
  });
  it('renders translated navigation with accessible labels', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    TestBed.inject(Preferences).setLanguage('es');
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('nav')?.textContent).toContain('Conectar teléfono');
    expect(root.textContent).toContain('EDICIÓN DE ESCRITORIO');
  });
  it('shows connection guidance and identifies browser preview', async () => {
    const harness = await RouterTestingHarness.create('/connect');
    expect(harness.routeNativeElement?.querySelectorAll('ol li').length).toBe(3);
    expect(harness.routeNativeElement?.textContent).toContain('Desktop connection required');
  });
  it('changes language through the settings control', async () => {
    const harness = await RouterTestingHarness.create('/settings');
    const select = harness.routeDebugElement!.query(By.directive(Select))
      .componentInstance as Select;
    select.valueChange.emit('es');
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('A tu manera.');
    expect(localStorage.getItem('droid-setup.language')).toBe('es');
  });
});
