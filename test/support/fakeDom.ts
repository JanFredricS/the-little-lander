/**
 * Minimal DOM stand-in for node tests of the DOM touch layer (no jsdom in
 * this repo): elements with style / classList / dataset / children, event
 * listeners with bubbling, and pointer capture bookkeeping that follows the
 * spec's one rule we rely on: removing the capture target from the tree loses
 * the capture (fired at the document, not at the old parent).
 */

type Listener = (e: FakeEvent) => void;

export interface FakeEvent {
  type: string;
  pointerId: number;
  pointerType: string;
  button: number;
  clientX: number;
  clientY: number;
  target: FakeElement | null;
  preventDefault(): void;
  stopPropagation(): void;
}

class ClassList {
  private readonly set = new Set<string>();
  constructor(private readonly el: FakeElement) {}
  add(...c: string[]) {
    c.forEach((x) => this.set.add(x));
  }
  remove(...c: string[]) {
    c.forEach((x) => this.set.delete(x));
  }
  contains(c: string) {
    return this.set.has(c);
  }
  toggle(c: string, on?: boolean) {
    const v = on ?? !this.set.has(c);
    if (v) this.set.add(c);
    else this.set.delete(c);
    return v;
  }
  setFrom(s: string) {
    this.set.clear();
    s.split(/\s+/).filter(Boolean).forEach((x) => this.set.add(x));
  }
  toString() {
    return [...this.set].join(' ');
  }
  get owner() {
    return this.el;
  }
}

export class FakeElement {
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly classList = new ClassList(this);
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  textContent = '';
  id = '';
  width = 0;
  height = 0;
  clientWidth = 0;
  clientHeight = 0;
  private readonly listeners = new Map<string, Listener[]>();
  private readonly attrs = new Map<string, string>();
  constructor(
    readonly tagName: string,
    private readonly dom: FakeDom,
  ) {}
  set className(v: string) {
    this.classList.setFrom(v);
  }
  get className() {
    return this.classList.toString();
  }
  get childElementCount() {
    return this.children.length;
  }
  get isConnected(): boolean {
    let e: FakeElement | null = this;
    while (e) {
      if (e === this.dom.root) return true;
      e = e.parent;
    }
    return false;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  appendChild(c: FakeElement) {
    c.remove();
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...c: FakeElement[]) {
    c.forEach((x) => this.appendChild(x));
  }
  replaceChildren(...c: FakeElement[]) {
    for (const x of [...this.children]) x.remove();
    this.append(...c);
  }
  remove() {
    if (!this.parent) return;
    const p = this.parent;
    p.children.splice(p.children.indexOf(this), 1);
    this.parent = null;
    this.dom.onRemoved(this);
  }
  contains(o: FakeElement | null): boolean {
    for (let e = o; e; e = e.parent) if (e === this) return true;
    return false;
  }
  addEventListener(t: string, f: Listener) {
    const l = this.listeners.get(t) ?? [];
    l.push(f);
    this.listeners.set(t, l);
  }
  removeEventListener(t: string, f: Listener) {
    const l = this.listeners.get(t) ?? [];
    const i = l.indexOf(f);
    if (i >= 0) l.splice(i, 1);
  }
  /** Fire at this element and bubble up the (current) tree. */
  dispatch(e: FakeEvent) {
    let stopped = false;
    e.stopPropagation = () => void (stopped = true);
    for (let n: FakeElement | null = this; n && !stopped; n = n.parent) for (const f of [...(n.listeners.get(e.type) ?? [])]) f(e);
  }
  setPointerCapture(id: number) {
    this.dom.capture.set(id, this);
  }
  hasPointerCapture(id: number) {
    return this.dom.capture.get(id) === this;
  }
  releasePointerCapture(id: number) {
    if (this.dom.capture.get(id) === this) this.dom.capture.delete(id);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 };
  }
  getContext() {
    return null;
  }
}

export class FakeDom {
  readonly root: FakeElement;
  readonly head: FakeElement;
  readonly body: FakeElement;
  /** pointerId -> capture target. */
  readonly capture = new Map<number, FakeElement>();
  /** lostpointercapture events fired at the document (capture target removed from the tree). */
  readonly lostAtDocument: number[] = [];
  readonly windowListeners = new Map<string, Listener[]>();
  constructor() {
    this.root = new FakeElement('html', this);
    this.head = this.root.appendChild(new FakeElement('head', this));
    this.body = this.root.appendChild(new FakeElement('body', this));
  }
  onRemoved(el: FakeElement) {
    for (const [id, t] of [...this.capture]) {
      if (el.contains(t)) {
        this.capture.delete(id);
        this.lostAtDocument.push(id);
      }
    }
  }
  document() {
    return {
      createElement: (t: string) => new FakeElement(t, this),
      getElementById: (id: string) => {
        const walk = (e: FakeElement): FakeElement | null => (e.id === id ? e : e.children.map(walk).find(Boolean) ?? null);
        return walk(this.root);
      },
      head: this.head,
      body: this.body,
    };
  }
  window() {
    return {
      addEventListener: (t: string, f: Listener) => this.windowListeners.set(t, [...(this.windowListeners.get(t) ?? []), f]),
      removeEventListener: (t: string, f: Listener) => this.windowListeners.set(t, (this.windowListeners.get(t) ?? []).filter((x) => x !== f)),
      navigator: { maxTouchPoints: 0 },
      matchMedia: () => ({ matches: false }),
    };
  }
  fireWindow(type: string) {
    for (const f of this.windowListeners.get(type) ?? []) f({ type } as FakeEvent);
  }
  /** A pointer event at host-relative (x, y): routed to the capture target, else to `hit` (the element under the finger). */
  pointer(type: string, id: number, x: number, y: number, hit: FakeElement): FakeEvent {
    const target = this.capture.get(id) ?? hit;
    const e: FakeEvent = { type, pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y, target, preventDefault() {}, stopPropagation() {} };
    target.dispatch(e);
    if (type === 'pointerup' || type === 'pointercancel') this.capture.delete(id);
    return e;
  }
}
