/** input.ts — keyboard/mouse state tracker. Pure bookkeeping, no game logic. */

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  /** Left mouse button held — the §15.3 primary fire. */
  private mouseDown = false;
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
    window.addEventListener('blur', () => {
      this.held.clear();
      this.mouseDown = false;
    });
    target.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
  }

  isHeld(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /** Left mouse button currently held (auto-fire is gated by weapon cooldown). */
  isFiring(): boolean {
    return this.mouseDown;
  }

  /** True once per physical key press; consumed at end of frame. */
  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
