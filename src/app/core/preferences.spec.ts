import { TestBed } from '@angular/core/testing';
import { Preferences } from './preferences';

describe('Language preferences', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it('defaults to English and rejects unsupported saved languages', () => {
    localStorage.setItem('droid-setup.language', 'fr');
    expect(TestBed.inject(Preferences).language()).toBe('en');
  });
  it('switches text and document language and persists Spanish', () => {
    const p = TestBed.inject(Preferences);
    p.setLanguage('es');
    expect(p.t('connect')).toBe('Conectar teléfono');
    expect(document.documentElement.lang).toBe('es');
    TestBed.resetTestingModule();
    expect(TestBed.inject(Preferences).language()).toBe('es');
  });
  it('remembers whether the sidebar is collapsed', () => {
    const p = TestBed.inject(Preferences);
    expect(p.sidebarCollapsed()).toBe(false);
    p.toggleSidebar();
    TestBed.resetTestingModule();
    expect(TestBed.inject(Preferences).sidebarCollapsed()).toBe(true);
  });
  it('keeps the session language but reports storage failures', () => {
    const p = TestBed.inject(Preferences);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    p.setLanguage('es');
    expect(p.language()).toBe('es');
    expect(p.storageError()).toBe(true);
  });
});
