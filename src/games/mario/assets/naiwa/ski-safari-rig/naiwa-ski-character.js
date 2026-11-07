/**
 * Yellow Naiwa (黄色奶蛙/奶娃) Vector Character Controller for Ski Safari (滑雪大冒险)
 * Supports both HTML5 Canvas 2D rendering and DOM SVG mounting.
 */
export class NaiwaSkiCharacter {
  static ACTIONS = {
    'ski-glide':        { file: 'actions/01-ski-glide.svg',        tracedFile: 'traced-ski-actions/traced-01-ski-glide.svg',        label: '基础滑行 (Glide)' },
    'ski-boost':        { file: 'actions/02-ski-boost.svg',        tracedFile: 'traced-ski-actions/traced-02-ski-boost.svg',        label: '俯冲加速 (Boost)' },
    'ski-jump-laugh':   { file: 'actions/03-ski-jump-laugh.svg',   tracedFile: 'traced-ski-actions/traced-03-ski-jump-laugh.svg',   label: '腾空大笑 (Jump Laugh)' },
    'ski-backflip':     { file: 'actions/04-ski-backflip.svg',     tracedFile: 'traced-ski-actions/traced-04-ski-backflip.svg',     label: '空中后空翻 (Backflip)' },
    'ski-belly-slide':  { file: 'actions/05-ski-belly-slide.svg',  tracedFile: 'traced-ski-actions/traced-05-ski-belly-slide.svg',  label: '笑倒躺滑 (Belly Slide)' },
    'ski-crash':        { file: 'actions/06-ski-crash.svg',        tracedFile: 'traced-ski-actions/traced-06-ski-crash.svg',        label: '摔倒撞雪 (Crash)' },
    'ski-ride-penguin': { file: 'actions/07-ski-ride-penguin.svg', tracedFile: 'actions/07-ski-ride-penguin.svg',                   label: '骑乘企鹅 (Ride Penguin)' },
    'orig-idle':        { file: 'actions/08-orig-idle.svg',        tracedFile: '../extracted-traced-svg/classic-side-belly/classic-side-belly-01.svg', label: '原版待机 (Idle)' },
    'orig-run':         { file: 'actions/09-orig-run.svg',         tracedFile: '../extracted-traced-svg/running-right/running-right-02.svg',           label: '原版奔跑 (Run)' },
    'orig-wave':        { file: 'actions/10-orig-wave.svg',        tracedFile: '../extracted-traced-svg/waving/waving-03.svg',                         label: '原版招手 (Wave)' },
    'orig-belly-laugh': { file: 'actions/11-orig-belly-laugh.svg', tracedFile: '../extracted-traced-svg/belly-laugh/belly-laugh-03.svg',               label: '原版捧腹大笑 (Laugh)' },
    'orig-sad-slump':   { file: 'actions/12-orig-sad-slump.svg',   tracedFile: '../extracted-traced-svg/sad-failed/sad-failed-05.svg',                 label: '原版沮丧蹲下 (Sad)' }
  };

  /**
   * @param {Object} options
   * @param {string} [options.basePath='./ski-safari-rig'] - Path to ski-safari-rig directory
   * @param {'skeletal'|'traced'} [options.mode='skeletal'] - Vector rendering style
   * @param {string} [options.initialAction='ski-glide'] - Initial action state
   */
  constructor(options = {}) {
    this.basePath = (options.basePath || './ski-safari-rig').replace(/\/$/, '');
    this.mode = options.mode || 'skeletal';
    this.state = options.initialAction || 'ski-glide';
    this.images = new Map();
    this.rotation = 0; // Additional slope or backflip angle in radians
    this.flipX = false;
  }

  /**
   * Preload all SVG actions as Image objects for HTML5 Canvas 2D rendering
   */
  async preloadAll() {
    const promises = [];
    for (const [key, info] of Object.entries(NaiwaSkiCharacter.ACTIONS)) {
      for (const mode of ['skeletal', 'traced']) {
        const rel = mode === 'traced' ? info.tracedFile : info.file;
        const url = `${this.basePath}/${rel}`;
        const cacheKey = `${mode}:${key}`;
        promises.push(
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              this.images.set(cacheKey, img);
              resolve(img);
            };
            img.onerror = () => resolve(null);
            img.src = url;
          })
        );
      }
    }
    await Promise.all(promises);
  }

  /**
   * Switch character action state
   * @param {keyof typeof NaiwaSkiCharacter.ACTIONS} actionName
   */
  setAction(actionName) {
    if (NaiwaSkiCharacter.ACTIONS[actionName]) {
      this.state = actionName;
    }
  }

  /**
   * Switch between 'skeletal' (clean layered Bezier rig) and 'traced' (3D-shaded traced paths)
   * @param {'skeletal'|'traced'} mode
   */
  setMode(mode) {
    this.mode = mode === 'traced' ? 'traced' : 'skeletal';
  }

  /**
   * Get the URL of the current SVG asset
   */
  getCurrentSvgUrl() {
    const info = NaiwaSkiCharacter.ACTIONS[this.state] || NaiwaSkiCharacter.ACTIONS['ski-glide'];
    const rel = this.mode === 'traced' ? info.tracedFile : info.file;
    return `${this.basePath}/${rel}`;
  }

  /**
   * Draw the yellow Naiwa onto an HTML5 2D Canvas context
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Center X position
   * @param {number} y - Bottom/Feet Y position on the ski slope
   * @param {number} [scale=0.6] - Scale factor
   * @param {number} [slopeAngle=0] - Slope angle in radians
   */
  drawToCanvas(ctx, x, y, scale = 0.6, slopeAngle = 0) {
    const cacheKey = `${this.mode}:${this.state}`;
    const img = this.images.get(cacheKey);
    if (!img) return;

    const w = 280 * scale;
    const h = 260 * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(slopeAngle + this.rotation);
    if (this.flipX) {
      ctx.scale(-1, 1);
    }
    // Anchor at the ski bottom center
    ctx.drawImage(img, -w * 0.5, -h * 0.82, w, h);
    ctx.restore();
  }
}
