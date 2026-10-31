import { TestBed } from '@angular/core/testing';
import { CopyButton } from './copy-button';
import { Desktop } from '../../core/desktop';

describe('Copy device information', () => {
  afterEach(() => vi.useRealTimers());
  it('writes only after a click and confirms success', async () => {
    vi.useFakeTimers();
    const copy = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [{ provide: Desktop, useValue: { copy } }] });
    const fixture = TestBed.createComponent(CopyButton);
    fixture.componentRef.setInput('value', 'Example model');
    fixture.componentRef.setInput('label', 'Model');
    fixture.detectChanges();
    expect(copy).not.toHaveBeenCalled();
    await fixture.componentInstance.copy();
    expect(copy).toHaveBeenCalledWith('Example model');
    expect(fixture.componentInstance.state()).toBe('copied');
    await vi.advanceTimersByTimeAsync(2500);
    expect(fixture.componentInstance.state()).toBe('idle');
  });
  it('reports clipboard errors instead of claiming success', async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: Desktop, useValue: { copy: () => Promise.reject(new Error('Unavailable')) } },
      ],
    });
    const fixture = TestBed.createComponent(CopyButton);
    fixture.componentRef.setInput('value', 'Example');
    fixture.componentRef.setInput('label', 'Model');
    fixture.detectChanges();
    await fixture.componentInstance.copy();
    expect(fixture.componentInstance.state()).toBe('failed');
  });
});
