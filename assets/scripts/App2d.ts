import { _decorator, Component, Node, Sprite } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('App2d')
export class App2d extends Component {

    @property(Node)
    hitNode: Node = null;

    private _hitTime: number = 0;
    private _hitDuration: number = 0.3;

    onEnable() {
        this.node.on(Node.EventType.TOUCH_END, this.onHit, this);
    }

    onDisable() {
        this.node.off(Node.EventType.TOUCH_END, this.onHit, this);
    }

    onHit() {
        this._hitTime = 0;
    }

    protected update(dt: number): void {
        if (this._hitTime < this._hitDuration) {
            this._hitTime += dt;
            this.hitNode.getComponent(Sprite).material.setProperty('hitTime', this._hitTime);
        }
    }
}


