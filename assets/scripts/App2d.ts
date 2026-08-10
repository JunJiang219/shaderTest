import { _decorator, Component, EventTouch, Layout, Node, Sprite, Vec2 } from 'cc';
import { Blur } from './Blur';
import { SlotsWinRenderer } from './slots/SlotsWinRenderer';
const { ccclass, property } = _decorator;

enum ECtrl {
    UseEff,
    NotUseEff,
    Recusive,
    NotRecusive,
    ModifyIns,
}

@ccclass('App2d')
export class App2d extends Component {

    @property(SlotsWinRenderer)
    renderer: SlotsWinRenderer = null;

    protected start(): void {
        // 坐标均相对 renderer 所在节点的锚点，单位是像素。
        // this.renderer.setLinePoints([
        //     new Vec2(-400, 0),
        //     new Vec2(0, 120),
        //     new Vec2(400, 0),
        // ]);

        // this.renderer.syncNow();
    }

    onEnable() {
        // this.btn.on(Node.EventType.TOUCH_END, this.onBtnTouch, this);
    }

    onDisable() {
        // this.btn.off(Node.EventType.TOUCH_END, this.onBtnTouch, this);
    }

    onBtnTouch(evt: EventTouch) {

    }
}


