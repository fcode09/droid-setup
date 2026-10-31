import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

export interface SelectOption {
  value: string;
  label: string;
}
let nextId = 0;

@Component({ selector: 'app-select', templateUrl: './select.html', styleUrl: './select.scss' })
export class Select implements OnDestroy {
  readonly options = input.required<SelectOption[]>();
  readonly value = input('');
  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly disabled = input(false);
  readonly compact = input(false);
  readonly valueChange = output<string>();
  readonly expanded = signal(false);
  readonly activeIndex = signal(0);
  readonly selectedLabel = computed(
    () =>
      this.options().find((option) => option.value === this.value())?.label || this.placeholder(),
  );
  readonly popupId = `droid-select-${nextId++}`;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly popup = viewChild.required<ElementRef<HTMLDivElement>>('popup');
  private frame = 0;

  toggle(): void {
    this.expanded() ? this.close(true) : this.open();
  }
  open(last = false): void {
    if (this.disabled() || !this.options().length || this.expanded()) return;
    const button = this.trigger().nativeElement;
    const popup = this.popup().nativeElement;
    const rect = button.getBoundingClientRect();
    const width = Math.min(
      Math.max(rect.width, this.compact() ? 150 : rect.width),
      window.innerWidth - 24,
    );
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)}px`;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const height = Math.min(260, Math.max(below, above));
    popup.style.maxHeight = `${height}px`;
    if (below >= Math.min(180, this.options().length * 44 + 12) || below >= above) {
      popup.style.top = `${rect.bottom + 6}px`;
      popup.style.bottom = 'auto';
    } else {
      popup.style.top = 'auto';
      popup.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    }
    this.expanded.set(true);
    popup.showPopover();
    const selected = this.options().findIndex((option) => option.value === this.value());
    this.focusOption(last ? this.options().length - 1 : Math.max(0, selected));
    document.addEventListener('scroll', this.onScroll, true);
  }
  close(restoreFocus: boolean): void {
    if (!this.expanded()) return;
    this.expanded.set(false);
    cancelAnimationFrame(this.frame);
    this.popup().nativeElement.hidePopover();
    document.removeEventListener('scroll', this.onScroll, true);
    if (restoreFocus) this.trigger().nativeElement.focus();
  }
  choose(index: number): void {
    const option = this.options()[index];
    if (!option) return;
    this.valueChange.emit(option.value);
    this.close(true);
  }
  onTriggerKey(event: KeyboardEvent): void {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      this.open(event.key === 'End' || event.key === 'ArrowUp');
    }
  }
  onOptionKey(event: KeyboardEvent): void {
    const count = this.options().length;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.choose(this.activeIndex());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close(true);
    } else if (event.key === 'Tab') {
      this.close(true);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      this.focusOption(
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? count - 1
            : (this.activeIndex() + (event.key === 'ArrowDown' ? 1 : -1) + count) % count,
      );
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
      const start = this.activeIndex() + 1;
      for (let offset = 0; offset < count; offset++) {
        const index = (start + offset) % count;
        if (
          this.options()[index].label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase())
        ) {
          event.preventDefault();
          this.focusOption(index);
          break;
        }
      }
    }
  }
  private focusOption(index: number): void {
    this.activeIndex.set(index);
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.popup()
        .nativeElement.querySelectorAll<HTMLButtonElement>('.option')
        [index]?.focus({ preventScroll: true });
    });
  }
  private readonly onScroll = (event: Event): void => {
    if (!this.popup().nativeElement.contains(event.target as Node)) this.close(false);
  };
  @HostListener('document:pointerdown', ['$event'])
  onOutside(event: PointerEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }
  @HostListener('window:resize') onResize(): void {
    this.close(false);
  }
  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    document.removeEventListener('scroll', this.onScroll, true);
  }
}
