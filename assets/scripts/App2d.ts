import { _decorator, Button, Component, EventTouch, instantiate, Label, Layout, Node, Sprite, Vec2 } from 'cc';
import { Blur } from './Blur';
import { SlotsWinLineDrawStyle, SlotsWinRenderer } from './slots/SlotsWinRenderer';
const { ccclass, property } = _decorator;

enum EBtnTag {
    LineReveal_0,     // 直接揭示中奖线
    LineReveal_1,     // 动态揭示中奖线
    MaxTag,
}

const btnsInfo = {
    [EBtnTag.LineReveal_0]: { text: "LineReveal_0" },
    [EBtnTag.LineReveal_1]: { text: "LineReveal_1" },
}


@ccclass('App2d')
export class App2d extends Component {

    @property(SlotsWinRenderer)
    renderer: SlotsWinRenderer = null;

    @property(Node)
    btnTemplate: Node = null;

    @property(Node)
    btnRoot: Node = null;

    private _btnInited: boolean = false;
    private _btnsMap: Map<number, Node> = new Map<number, Node>();

    protected onLoad(): void {
        this.initBtns();
    }

    onEnable() {
        this._btnsMap.forEach((value: Node, key: number) => {
            value.on(Node.EventType.TOUCH_END, this.onBtnTouch, this);
        });
    }

    protected start(): void {

        this.renderer.setLines([
            [
                new Vec2(-320, 120),
                new Vec2(0, -80),
                new Vec2(320, 120),
            ],
            [
                new Vec2(-320, -120),
                new Vec2(0, 100),
                new Vec2(320, -120),
            ],
        ]);
        this.renderer.syncNow();
    }

    onDisable() {
        this._btnsMap.forEach((value: Node, key: number) => {
            value.off(Node.EventType.TOUCH_END, this.onBtnTouch, this);
        });
    }

    onBtnTouch(evt: EventTouch) {
        const nodeName = evt.target.name as string;
        const nameArr = nodeName.split('_');
        const nodeTag = parseInt(nameArr[nameArr.length - 1]);
        switch (nodeTag) {
            case EBtnTag.LineReveal_0:
                this.renderer.showCompleteLine();
                break;
            case EBtnTag.LineReveal_1:
                this.renderer.playLineReveal();
                break;
            default:
                console.warn("未知按钮");
                break;
        }
    }

    // 创建btns
    private initBtns() {
        if (this._btnInited) return;

        this._btnInited = true;
        for (let index = 0; index < EBtnTag.MaxTag; index++) {
            const element = btnsInfo[index];
            if (!element) continue;

            const btnNode = (0 == index) ? this.btnTemplate : instantiate(this.btnTemplate);
            btnNode.parent = this.btnRoot;
            btnNode.name = "Button_" + index;
            btnNode.getComponentInChildren(Label).string = element.text;

            this._btnsMap.set(index, btnNode);
        }
    }
}


