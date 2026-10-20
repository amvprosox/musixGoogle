import { clamp, keyboardSliderValue, ratioFromPointer } from '../../shared/player-math';
import { h } from '../dom';

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  bigStep: number;
  className?: string;
  format: (value: number) => string;
  onInput?: (value: number) => void;
  onCommit: (value: number) => void;
  onHover?: (value: number, clientX: number, rect: DOMRect) => void;
  onHoverEnd?: () => void;
  tolerance?: number;
}

const HOLD_MS = 1200;

export class Slider {
  readonly el: HTMLDivElement;
  private value: number;
  private max: number;
  private dragging = false;
  private disabled = false;
  private holdUntil = 0;
  private heldValue: number | null = null;
  private pointerId: number | null = null;

  constructor(private readonly options: SliderOptions) {
    this.value = options.min;
    this.max = options.max;
    this.el = h(
      'div',
      {
        className: `slider${options.className ? ` ${options.className}` : ''}`,
        attrs: {
          role: 'slider',
          tabindex: 0,
          'aria-label': options.label,
          'aria-valuemin': options.min,
          'aria-valuemax': options.max,
          'aria-valuenow': options.min,
          'aria-orientation': 'horizontal',
        },
      },
      [
        h('div', { className: 'slider-track' }, [h('div', { className: 'slider-fill' })]),
        h('div', { className: 'slider-thumb' }),
      ],
    );
    this.el.addEventListener('pointerdown', (event) => {
      this.onPointerDown(event);
    });
    this.el.addEventListener('pointermove', (event) => {
      this.onPointerMove(event);
    });
    this.el.addEventListener('pointerup', (event) => {
      this.onPointerUp(event);
    });
    this.el.addEventListener('pointercancel', () => {
      this.cancelDrag();
    });
    this.el.addEventListener('lostpointercapture', () => {
      if (this.dragging) {
        this.finishDrag();
      }
    });
    this.el.addEventListener('pointerleave', () => {
      if (!this.dragging && this.options.onHoverEnd) {
        this.options.onHoverEnd();
      }
    });
    this.el.addEventListener('keydown', (event) => {
      this.onKeyDown(event);
    });
    this.render();
  }

  private valueFromPointer(clientX: number): number {
    const rect = this.el.getBoundingClientRect();
    const ratio = ratioFromPointer(clientX, rect.left, rect.width);
    return this.options.min + ratio * (this.max - this.options.min);
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.disabled || event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.el.focus({ preventScroll: true });
    this.dragging = true;
    this.pointerId = event.pointerId;
    this.el.setPointerCapture(event.pointerId);
    this.el.dataset.dragging = 'true';
    this.value = this.valueFromPointer(event.clientX);
    this.render();
    this.emitHover(event.clientX);
    if (this.options.onInput) {
      this.options.onInput(this.value);
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.disabled) {
      return;
    }
    if (this.dragging) {
      this.value = this.valueFromPointer(event.clientX);
      this.render();
      if (this.options.onInput) {
        this.options.onInput(this.value);
      }
    }
    this.emitHover(event.clientX);
  }

  private emitHover(clientX: number): void {
    if (!this.options.onHover) {
      return;
    }
    const rect = this.el.getBoundingClientRect();
    this.options.onHover(this.valueFromPointer(clientX), clientX, rect);
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }
    if (this.pointerId !== null && this.el.hasPointerCapture(this.pointerId)) {
      this.el.releasePointerCapture(this.pointerId);
    }
    this.value = this.valueFromPointer(event.clientX);
    this.finishDrag();
  }

  private finishDrag(): void {
    this.dragging = false;
    this.pointerId = null;
    delete this.el.dataset.dragging;
    this.commit(this.value);
    if (this.options.onHoverEnd && !this.el.matches(':hover')) {
      this.options.onHoverEnd();
    }
  }

  private cancelDrag(): void {
    this.dragging = false;
    this.pointerId = null;
    delete this.el.dataset.dragging;
    if (this.options.onHoverEnd) {
      this.options.onHoverEnd();
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.disabled) {
      return;
    }
    const next = keyboardSliderValue(
      event.key,
      this.value,
      this.options.min,
      this.max,
      this.options.step,
      this.options.bigStep,
    );
    if (next === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.value = next;
    this.render();
    this.commit(next);
  }

  private commit(value: number): void {
    this.heldValue = value;
    this.holdUntil = Date.now() + HOLD_MS;
    this.options.onCommit(value);
  }

  setValue(value: number): void {
    if (this.dragging) {
      return;
    }
    const next = clamp(value, this.options.min, this.max);
    if (this.heldValue !== null) {
      const tolerance = this.options.tolerance ?? this.options.step;
      if (Math.abs(next - this.heldValue) <= tolerance || Date.now() > this.holdUntil) {
        this.heldValue = null;
      } else {
        return;
      }
    }
    if (next === this.value) {
      return;
    }
    this.value = next;
    this.render();
  }

  setMax(max: number): void {
    const safe = Number.isFinite(max) && max > this.options.min ? max : this.options.min + 1;
    if (safe === this.max) {
      return;
    }
    this.max = safe;
    this.el.setAttribute('aria-valuemax', String(Math.round(safe)));
    this.render();
  }

  setDisabled(disabled: boolean): void {
    if (disabled === this.disabled) {
      return;
    }
    this.disabled = disabled;
    this.el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    this.el.tabIndex = disabled ? -1 : 0;
    if (disabled && this.dragging) {
      this.cancelDrag();
    }
  }

  isDragging(): boolean {
    return this.dragging;
  }

  private render(): void {
    const range = this.max - this.options.min;
    const pct = range > 0 ? ((this.value - this.options.min) / range) * 100 : 0;
    this.el.style.setProperty('--value', `${clamp(pct, 0, 100).toFixed(3)}%`);
    this.el.setAttribute('aria-valuenow', String(Math.round(this.value * 100) / 100));
    this.el.setAttribute('aria-valuetext', this.options.format(this.value));
  }
}
