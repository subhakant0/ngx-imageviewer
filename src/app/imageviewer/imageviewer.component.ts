import { Component, Input, ViewChild, ElementRef, AfterViewInit, Renderer, Inject, OnDestroy } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

import { ImageViewerConfig, IMAGEVIEWER_CONFIG, IMAGEVIEWER_CONFIG_DEFAULT, ButtonConfig, ButtonStyle } from './imageviewer.config';

@Component({
  selector: 'ngx-imageviewer',
  templateUrl: './imageviewer.component.html',
  styleUrls: ['./imageviewer.component.scss']
})
export class ImageViewerComponent implements AfterViewInit, OnDestroy {

  //#region Input properties
  @Input() src: string;

  private _width;
  get width() { return this._width; }
  @Input('width') set width(value) {
    if (value === this._width) { return; }
    this._width = value;
    if (this.canvas) { this.canvas.width = this._width; }
    this.resetImage();
  }

  private _height;
  get height() { return this._height; }
  @Input('height') set height(value) {
    if (value === this._height) { return; }
    this._height = value;
    if (this.canvas) { this.canvas.height = this._height; }
    this.resetImage();
  }

  @ViewChild('imageContainer') canvasRef: ElementRef;
  //#endregion

  //#region Private properties
  // Canvas 2D context
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  // dirty state
  private dirty = true;

  // flag to stop render loop
  private stopRendering = false;

  // Image Scale
  private scale = 1;
  private minScale = 0;
  private maxScale = 4;
  private angle = 0;

  // Image centre (scroll offset)
  private centre = { x: 0, y: 0 };

  // default buttons that are always visible
  private zoomOutButton: Button;
  private zoomInButton: Button;
  private rotateLeftButton: Button;
  private rotateRightButton: Button;
  private resetButton: Button;

  // contains all active buttons
  private buttons = [];

  // current tool tip (used to track change of tool tip)
  private currentTooltip = null;

  // UI element which is currently in focus, i.e. the mouse is hovering over it
  private focusUIElement = null;
  // check if is moving with touch
  private onTouchMode = false;
  // listeners destroy array
  private listenDestroyList = []
  // touch start state
  private touchStartState: any = {};

  // image
  private image = new Image();

  //#endregion

  constructor(
    private sanitizer: DomSanitizer,
    private renderer: Renderer,
    @Inject(IMAGEVIEWER_CONFIG) private config: ImageViewerConfig
  ) {
    this.config = this.extendsDefaultConfig(config);
    this.zoomOutButton = new Button(this.config.zoomOutButton, this.config.buttonStyle);
    this.zoomInButton = new Button(this.config.zoomInButton, this.config.buttonStyle);
    this.rotateLeftButton = new Button(this.config.rotateLeftButton, this.config.buttonStyle);
    this.rotateRightButton = new Button(this.config.rotateRightButton, this.config.buttonStyle);
    this.resetButton = new Button(this.config.resetButton, this.config.buttonStyle);
    this.buttons = [
      this.zoomOutButton,
      this.zoomInButton,
      this.rotateLeftButton,
      this.rotateRightButton,
      this.resetButton
    ].filter(item => item.display)
    .sort((a, b) => a.sortId - b.sortId);
  }

  ngAfterViewInit() {
    this.canvas = this.canvasRef.nativeElement;
    this.context = this.canvas.getContext('2d');

    this.canvas.width = this.width || this.config.width;
    this.canvas.height = this.height || this.config.height;

    this.image.addEventListener('load', (evt) => this.updateCanvas(), false);
    this.image.src = this.src;

    this.zoomOutButton.onClick = (evt) => { this.zoomOut(); return false; };
    this.zoomInButton.onClick = (evt) => { this.zoomIn(); return false; };
    this.rotateLeftButton.onClick = (evt) => { this.rotateLeft(); return false; };
    this.rotateRightButton.onClick = (evt) => { this.rotateRight(); return false; };
    this.resetButton.onClick = (evt) => { this.resetImage(); return false; };

    this.addEventListeners();
  }

  ngOnDestroy() {
    this.listenDestroyList.forEach(listenDestroy => {
      if(typeof listenDestroy === 'function') { 
        listenDestroy();
      }
    });
  }

  onTap(evt) {
    const activeElement = this.getUIElement(this.screenToCanvasCentre(evt.center));
    if (activeElement !== null) { activeElement.onClick(evt); }
  }
  onPanEnd() { this.touchStartState.centre = undefined; }
  onPinchEnd() { this.touchStartState.scale = undefined; }
  onRotateEnd() { this.touchStartState.angle = undefined;}

  private processTouchEvent(evt) {
    // process pan
    if(!this.touchStartState.centre) { this.touchStartState.centre = this.centre; }
    this.centre = {
      x: this.touchStartState.centre.x + evt.deltaX,
      y: this.touchStartState.centre.y + evt.deltaY
    };

    // process pinch in/out
    if(!this.touchStartState.scale) { this.touchStartState.scale = this.scale; }
    const newScale = this.touchStartState.scale * evt.scale;
    this.scale = newScale > this.maxScale ? this.maxScale : newScale < this.minScale ? this.minScale : newScale;

    // TODO implement rotantin 90 to 90 steps
    // process rotate left/right
    if(!this.touchStartState.angle) { this.touchStartState.angle = this.angle; }
    // this.angle = this.touchStartState.angle + evt.angle;

    this.dirty = true;
  }
  

  private extendsDefaultConfig(cfg: ImageViewerConfig) {
    const defaultCfg = IMAGEVIEWER_CONFIG_DEFAULT;
    const localCfg = Object.assign({}, defaultCfg, cfg);
    if (cfg.buttonStyle) { localCfg.buttonStyle = Object.assign(defaultCfg.buttonStyle, cfg.buttonStyle); }
    if (cfg.tooltips) { localCfg.tooltips = Object.assign(defaultCfg.tooltips, cfg.tooltips); }
    if (cfg.zoomOutButton) { localCfg.zoomOutButton = Object.assign(defaultCfg.zoomOutButton, cfg.zoomOutButton); }
    if (cfg.zoomInButton) { localCfg.zoomInButton = Object.assign(defaultCfg.zoomInButton, cfg.zoomInButton); }
    if (cfg.rotateLeftButton) { localCfg.rotateLeftButton = Object.assign(defaultCfg.rotateLeftButton, cfg.rotateLeftButton); }
    if (cfg.rotateRightButton) { localCfg.rotateRightButton = Object.assign(defaultCfg.rotateRightButton, cfg.rotateRightButton); }
    if (cfg.resetButton) { localCfg.resetButton = Object.assign(defaultCfg.resetButton, cfg.resetButton); }
    return localCfg;
  }

  //#region Button Actions
  private zoomIn() {
    const newScale = this.scale * (1 + this.config.scaleStep);
    this.scale = newScale > this.maxScale ? this.maxScale : newScale;
    this.dirty = true;
  }

  private zoomOut() {
    const newScale = this.scale * (1 - this.config.scaleStep);
    this.scale = newScale < this.minScale ? this.minScale : newScale;
    this.dirty = true;
  }

  private rotateLeft() {
    this.angle = this.angle === 0 ? 270 : this.angle - 90;
    this.dirty = true;
  }

  private rotateRight() {
    this.angle = this.angle === 270 ? 0 : this.angle + 90;
    this.dirty = true;
  }

  private resetImage() {
    if (!this.image || !this.image.width || !this.canvas) { return; }
    const inverted = this.angle / 90 % 2 !== 0;
    const canvas = {
      width: !inverted ? this.canvas.width : this.canvas.height,
      height: !inverted ? this.canvas.height : this.canvas.width
    };

    if (((canvas.height / this.image.height) * this.image.width) <= canvas.width) {
      this.scale = canvas.height / this.image.height;
    } else {
      this.scale = canvas.width / this.image.width;
    }
    this.minScale = this.scale / 4;
    this.maxScale = this.scale * 4;

    // centre at image centre
    this.centre.x = this.canvas.width / 2;
    this.centre.y = this.canvas.height / 2;

    // image changed
    this.dirty = true;
  }
  //#endregion

  //#region Draw Canvas
  private updateCanvas() {
    if (!this.image || !this.image.width) { return; }

    this.resetImage();

    // start new render loop
    this.render();
  }

  private render() {
    // only re-render if dirty
    if (this.dirty) {
      this.dirty = false;

      const ctx = this.context;
      // clear canvas
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      // Draw background color;
      ctx.fillStyle = this.config.bgStyle;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // draw image (transformed, rotate and scaled)
      ctx.save();

      ctx.translate(this.centre.x, this.centre.y);
      ctx.rotate(this.angle * Math.PI / 180);
      ctx.scale(this.scale, this.scale);
      ctx.drawImage(this.image, -this.image.width / 2, -this.image.height / 2);

      ctx.restore();

      // draw buttons
      this.drawButtons(ctx);
    }
    if (!this.stopRendering) {
      requestAnimationFrame(() => this.render());
    }
  }

  private drawButtons(ctx) {
    const padding = this.config.tooltips.padding;
    const radius = this.config.tooltips.radius;
    const gap = 2 * radius + padding;
    const x = this.canvas.width - radius - padding;
    const y = this.canvas.height - radius - padding;

    // draw buttons
    for (let i = 0; i < this.buttons.length; i++) {
      this.buttons[i].draw(ctx, x, y - gap * i, radius);
    }

    // draw tooltip
    if (this.currentTooltip !== null) {
      ctx.save();
      const fontSize = radius;
      ctx.font = fontSize + 'px sans-serif';

      // calculate position
      const textSize = ctx.measureText(this.currentTooltip).width
        , rectWidth = textSize + padding
        , rectHeight = fontSize * 0.70 + padding
        , rectX = this.canvas.width
                  - (2 * radius + 2 * padding) // buttons
                  - rectWidth
        , rectY = this.canvas.height - rectHeight - padding
        , textX = rectX + 0.5 * padding
        , textY = this.canvas.height - 1.5 * padding;

      ctx.globalAlpha = this.config.tooltips.bgAlpha;
      ctx.fillStyle = this.config.tooltips.bgStyle;
      this.drawRoundRectangle(ctx, rectX, rectY, rectWidth, rectHeight, 8, true, false);

      ctx.globalAlpha = this.config.tooltips.textAlpha;
      ctx.fillStyle = this.config.tooltips.textStyle;
      ctx.fillText(this.currentTooltip, textX, textY);

      ctx.restore();
    }
  }

  private drawRoundRectangle(ctx, x, y, width, height, radius, fill, stroke) {
    radius = (typeof radius === 'number') ? radius : 5;
    fill = (typeof fill === 'boolean') ? fill : true; // fill = default
    stroke = (typeof stroke === 'boolean') ? stroke : false;

    // draw round rectangle
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();

    if (fill) { ctx.fill(); }
    if (stroke) { ctx.stroke(); }
  }

  //#endregion

  //#region Event Handlers

  private addEventListeners() {
    // zooming
    this.listenDestroyList.push(this.renderer.listen(this.canvas, 'DOMMouseScroll', (evt) => this.onMouseWheel(evt)));
    this.listenDestroyList.push(this.renderer.listen(this.canvas, 'mousewheel', (evt) => this.onMouseWheel(evt)));

    // show tooltip when mouseover it
    this.listenDestroyList.push(this.renderer.listen(this.canvas, 'mousemove', (evt) => this.showTooltip(this.screenToCanvasCentre({ x: evt.clientX, y: evt.clientY }))));
  }

  private screenToCanvasCentre(pos: {x: number, y: number}) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: pos.x - rect.left, y: pos.y - rect.top};
  }

  private getUIElements(): Button[] {
    return this.buttons;
  }

  private getUIElement(pos: { x: number, y: number}) {
    const activeUIElement = this.getUIElements().filter((uiElement) => {
      return uiElement.isWithinBounds(pos.x, pos.y);
    });
    return (activeUIElement.length > 0 ) ? activeUIElement[0] : null;
  }

  private onMouseWheel(evt) {
    if (!evt) { evt = event; }
    evt.preventDefault();
    if (evt.detail < 0 || evt.wheelDelta > 0) { // up -> larger
      this.zoomIn();
    } else { // down -> smaller
      this.zoomOut();
    }
  }

  private showTooltip(pos: { x: number, y: number }) {
    this.getUIElements().forEach(x => x.hover = false);

    const activeElement = this.getUIElement(pos);
    const oldToolTip = this.currentTooltip;
    if (activeElement !== null) {
      if (typeof activeElement.hover !== 'undefined') {
        activeElement.hover = true;
      } 
      if (typeof activeElement.tooltip !== 'undefined') {
        this.currentTooltip = activeElement.tooltip;
      }
      // new focus UI element?
      if (activeElement !== this.focusUIElement) {
        this.focusUIElement = activeElement;
      }
    } else { // no activeElement
      this.currentTooltip = null;
      if (this.focusUIElement !== null) {
        this.focusUIElement = null;
      }
    }
    if (oldToolTip !== this.currentTooltip) { this.dirty = true; }
  }

  //#endregion
}

export class Button {
  sortId = 0;

  // drawn on position
  drawPosition = null;
  drawRadius = 0;

  icon: string;
  tooltip: string;

  // enabled state
  hover = false;

  // show/hide button
  display = true;

  constructor(
    config: ButtonConfig,
    private style: ButtonStyle
  ) {
    this.sortId = config.sortId;
    this.display = config.show;
    this.icon = config.icon;
    this.tooltip = config.tooltip;
  }

  // click action
  onClick(evt) { alert('no click action set!'); return true; }

  // mouse down action
  onMouseDown(evt) { return false; }

  isWithinBounds(x, y) {
    if (this.drawPosition === null) { return false; }
    const dx = Math.abs(this.drawPosition.x - x), dy = Math.abs(this.drawPosition.y - y);
    return dx * dx + dy * dy <= this.drawRadius * this.drawRadius;
  }

  draw(ctx, x, y, radius) {
    this.drawPosition = { x: x, y: y };
    this.drawRadius = radius;

    // preserve context
    ctx.save();

    // drawing settings
    const isHover = (typeof this.hover === 'function') ? this.hover() : this.hover;
    ctx.globalAlpha = (isHover) ? this.style.hoverAlpha : this.style.alpha;
    ctx.fillStyle = this.style.bgStyle;
    ctx.lineWidth = 0;

    // draw circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();
    if (this.style.borderWidth > 0) {
      ctx.lineWidth = this.style.borderWidth;
      ctx.strokeStyle = this.style.borderStyle;
      ctx.stroke();
    }

    // draw icon
    if (this.icon !== null) {
      ctx.save();
      // ctx.globalCompositeOperation = 'destination-out';
      this.drawIconFont(ctx, x, y, radius);
      ctx.restore();
    }

    // restore context
    ctx.restore();
  }

  private drawIconFont(ctx, centreX, centreY, size) {
    // font settings
    ctx.font = size + 'px ' + this.style.iconFontFamily;
    ctx.fillStyle = this.style.iconStyle;

    // calculate position
    const textSize = ctx.measureText(this.icon);
    const x = centreX - textSize.width / 2;
    const y = centreY + size / 2;

    // draw it
    ctx.fillText(this.icon, x, y);
  }
}
