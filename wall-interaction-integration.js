import WallManager from './wall-manager.js';

export const WALL_INTERACTION_INTEGRATION_VERSION = 1;
const PATCH_FLAG = Symbol.for('2m-tech.wall-interaction-integration.v1');

if (!WallManager.prototype[PATCH_FLAG]) {
  const originalEnableDrawing = WallManager.prototype.enableDrawing;

  WallManager.prototype.enablePan = function enableSingleWallPanHandler() {
    const canvas = document.getElementById('wall-canvas');
    if (!canvas) return;
    if (this.__wallPanCanvas === canvas && this.__wallPanPointerDown) return;

    if (this.__wallPanCanvas && this.__wallPanPointerDown) {
      this.__wallPanCanvas.removeEventListener('pointerdown', this.__wallPanPointerDown);
    }

    this.__wallPanCanvas = canvas;
    this.__wallPanPointerDown = event => {
      if (event.target !== canvas || this.drawing || !event.shiftKey) return;
      const start = {
        x: event.clientX,
        y: event.clientY,
        panX: this.pan.x,
        panY: this.pan.y
      };

      const move = moveEvent => {
        this.pan = {
          x: start.panX + moveEvent.clientX - start.x,
          y: start.panY + moveEvent.clientY - start.y
        };
        this.applyViewTransform();
      };

      const end = () => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end);
        canvas.removeEventListener('pointercancel', end);
      };

      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', end, { once:true });
      canvas.addEventListener('pointercancel', end, { once:true });
    };

    canvas.addEventListener('pointerdown', this.__wallPanPointerDown);
  };

  WallManager.prototype.enableDrawing = function enableSingleWallDrawingSession(...args) {
    if (this.drawing) {
      this.notify('Le mode dessin est déjà actif.', 'info');
      return;
    }
    return originalEnableDrawing.apply(this, args);
  };

  Object.defineProperty(WallManager.prototype, PATCH_FLAG, { value:true });
}

if (typeof window !== 'undefined') {
  window.WallInteractionIntegration = Object.freeze({ version:WALL_INTERACTION_INTEGRATION_VERSION });
}
