/** input.ts — keyboard/mouse state tracker. Pure bookkeeping, no game logic. */

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  /** Cursor in screen (canvas CSS pixel) coordinates. */
  mouseX = 0;
  mouseY = 0;

  attach(target: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
      // Keep space/arrows from scrolling and Tab (system map) from moving focus.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    target.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
  }

  isHeld(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /** True once per physical key press; consumed at end of frame. */
  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
