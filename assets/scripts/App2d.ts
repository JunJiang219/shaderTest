import { _decorator, Button, Component, EventTouch, instantiate, Label, Layout, Node, Sprite, Vec2 } from 'cc';
import { Blur } from './Blur';
import { SlotsWinDrawMode, SlotsWinFrameShape, SlotsWinLayerOrder, SlotsWinLineCornerStyle, SlotsWinLineDrawStyle, SlotsWinRenderer } from './slots/SlotsWinRenderer';
const { ccclass, property } = _decorator;

enum EBtnTag {
    LineReveal_0,     // 直接揭示中奖线
    LineReveal_1,     // 动态揭示中奖线
    DrawInside_0,     // 不绘制框内线
    DrawInside_1,     // 绘制框内线
    DrawLine,         // 画线
    DrawFrame,        // 画框
    DrawLineFrame,    // 画线框
    LAF,              // 线在框上
    FAL,              // 框在线上
    Sweep_0,          // 不扫光
    Sweep_1,          // 扫光
    Sharp,            // 折角
    Round,            // 圆角
    MaxTag,
}

const btnsInfo = {
    [EBtnTag.LineReveal_0]: { text: "静态线" },
    [EBtnTag.LineReveal_1]: { text: "动态线" },
    [EBtnTag.DrawInside_0]: { text: "线遮罩" },
    [EBtnTag.DrawInside_1]: { text: "线不遮罩" },
    [EBtnTag.DrawLine]: { text: "画线" },
    [EBtnTag.DrawFrame]: { text: "画框" },
    [EBtnTag.DrawLineFrame]: { text: "画线框" },
    [EBtnTag.LAF]: { text: "线在框上" },
    [EBtnTag.FAL]: { text: "框在线上" },
    [EBtnTag.Sweep_0]: { text: "不扫光" },
    [EBtnTag.Sweep_1]: { text: "扫光" },
    [EBtnTag.Sharp]: { text: "折角" },
    [EBtnTag.Round]: { text: "圆角" },
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
                new Vec2(160, -120),
                new Vec2(320, -120),
            ],
            // [
            //     new Vec2(-320, 120 - 20),
            //     new Vec2(0, -80 - 20),
            //     new Vec2(320, 120 - 20),
            // ],
            // [
            //     new Vec2(-320, 120 - 40),
            //     new Vec2(0, -80 - 40),
            //     new Vec2(320, 120 - 40),
            // ],
            // [
            //     new Vec2(-320, 120 - 60),
            //     new Vec2(0, -80 - 60),
            //     new Vec2(320, 120 - 60),
            // ],
            // [
            //     new Vec2(-320, 120 - 80),
            //     new Vec2(0, -80 - 80),
            //     new Vec2(320, 120 - 80),

            // ],
            // [
            //     new Vec2(-320, 120 - 100),
            //     new Vec2(0, -80 - 100),
            //     new Vec2(320, 120 - 100),
            // ],
            // [
            //     new Vec2(-320, 120 - 120),
            //     new Vec2(0, -80 - 120),
            //     new Vec2(320, 120 - 120),
            // ],
            // [
            //     new Vec2(-320, 120 - 140),
            //     new Vec2(0, -80 - 140),
            //     new Vec2(320, 120 - 140),
            // ],
            // [
            //     new Vec2(-320, 120 - 160),
            //     new Vec2(0, -80 - 160),
            //     new Vec2(320, 120 - 160),
            // ],
        ]);

        this.renderer.setFrames([
            { shape: SlotsWinFrameShape.RECTANGLE, position: new Vec2(-300, 0), width: 160, height: 160, radius: 50 },
            { shape: SlotsWinFrameShape.CIRCLE, position: new Vec2(0, 100), width: 100, height: 100, radius: 80 },
            { shape: SlotsWinFrameShape.RECTANGLE, position: new Vec2(300, 100), width: 100, height: 150, radius: 50 },
        ])

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

        let needSync = true;
        switch (nodeTag) {
            case EBtnTag.LineReveal_0:
                this.renderer.showCompleteLine();
                needSync = false;
                break;
            case EBtnTag.LineReveal_1:
                this.renderer.playLineReveal();
                needSync = false
                break;
            case EBtnTag.DrawInside_0:
                this.renderer.drawLineInsideFrames = false;
                break;
            case EBtnTag.DrawInside_1:
                this.renderer.drawLineInsideFrames = true;
                break;
            case EBtnTag.DrawLine:
                this.renderer.drawMode = SlotsWinDrawMode.LINE_ONLY;
                break;
            case EBtnTag.DrawFrame:
                this.renderer.drawMode = SlotsWinDrawMode.FRAME_ONLY;
                break;
            case EBtnTag.DrawLineFrame:
                this.renderer.drawMode = SlotsWinDrawMode.LINE_AND_FRAME;
                break;
            case EBtnTag.LAF:
                this.renderer.layerOrder = SlotsWinLayerOrder.LINE_ABOVE_FRAME;
                break;
            case EBtnTag.FAL:
                this.renderer.layerOrder = SlotsWinLayerOrder.FRAME_ABOVE_LINE;
                break;
            case EBtnTag.Sweep_0:
                this.renderer.enableLineSweep = false;
                break;
            case EBtnTag.Sweep_1:
                this.renderer.enableLineSweep = true;
                break;
            case EBtnTag.Sharp:
                this.renderer.lineCornerStyle = SlotsWinLineCornerStyle.SHARP;
                break;
            case EBtnTag.Round:
                this.renderer.lineCornerStyle = SlotsWinLineCornerStyle.ROUNDED;
                break;
            default:
                console.warn("未知按钮");
                needSync = false;
                break;
        }

        if (needSync) this.renderer.syncNow();
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


