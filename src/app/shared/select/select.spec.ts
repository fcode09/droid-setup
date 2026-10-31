import { TestBed } from '@angular/core/testing';
import { Select } from './select';

describe('Custom select', () => {
  beforeAll(() => {
    // jsdom lacks top-layer popovers; actual placement and focus are browser-checked.
    Object.defineProperty(HTMLElement.prototype, 'showPopover', {
      configurable: true,
      value: function (this: HTMLElement) {
        this.dataset['open'] = 'true';
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
      configurable: true,
      value: function (this: HTMLElement) {
        delete this.dataset['open'];
      },
    });
  });
  afterAll(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
    Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
  });

  async function setup(disabled = false) {
    const fixture = TestBed.createComponent(Select);
    fixture.componentRef.setInput('options', [
      { value: 'en', label: 'English' },
      { value: 'es', label: 'Español' },
    ]);
    fixture.componentRef.setInput('value', 'en');
    fixture.componentRef.setInput('label', 'Language');
    fixture.componentRef.setInput('disabled', disabled);
    await fixture.whenStable();
    return fixture;
  }

  it('opens with the selected option and chooses through keyboard navigation', async () => {
    const fixture = await setup();
    const component = fixture.componentInstance;
    const changed = vi.fn();
    component.valueChange.subscribe(changed);
    component.open();
    expect(component.expanded()).toBe(true);
    expect(component.activeIndex()).toBe(0);
    component.onOptionKey(new KeyboardEvent('keydown', { key: 'End' }));
    expect(component.activeIndex()).toBe(1);
    component.onOptionKey(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(changed).toHaveBeenCalledWith('es');
    expect(component.expanded()).toBe(false);
  });
  it('closes with Escape without changing the value', async () => {
    const fixture = await setup();
    const component = fixture.componentInstance;
    const changed = vi.fn();
    component.valueChange.subscribe(changed);
    component.open();
    component.onOptionKey(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.expanded()).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });
  it('supports type-to-select and outside dismissal', async () => {
    const fixture = await setup();
    const component = fixture.componentInstance;
    component.open();
    component.onOptionKey(new KeyboardEvent('keydown', { key: 'e' }));
    expect(component.activeIndex()).toBe(1);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(component.expanded()).toBe(false);
  });
  it('does not open when disabled', async () => {
    const fixture = await setup(true);
    fixture.componentInstance.open();
    expect(fixture.componentInstance.expanded()).toBe(false);
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
  });
});
