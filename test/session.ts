import type { ActionButton, Checkpoint, FeedItem, Fx, HudState, SceneState } from '../src/shared/protocol.js';
import type { Session } from '../src/server/hub.js';

/** A session that records everything the hub sends it. */
export class FakeSession implements Session {
  huds: HudState[] = [];
  scenes: SceneState[] = [];
  out: string[] = [];
  constructor(readonly id: string) {}
  send(text: string) {
    this.out.push(text);
  }
  setPrompt() {}
  hud(h: HudState) {
    this.huds.push(h);
  }
  scene(s: SceneState, _a: ActionButton[]) {
    this.scenes.push(s);
  }
  fx(_f: Fx) {}
  feeds: FeedItem[] = [];
  feed(item: FeedItem) {
    this.feeds.push(item);
  }
  checkpoints: (Checkpoint | null)[] = [];
  checkpoint(cp: Checkpoint | null) {
    this.checkpoints.push(cp);
  }
  clear() {}
  close() {}
  get lastHud() {
    return this.huds[this.huds.length - 1];
  }
}
