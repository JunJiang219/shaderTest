import {
    _decorator,
    builtinResMgr,
    CCObject,
    Color,
    Component,
    director,
    EffectAsset,
    Enum,
    error,
    Material,
    Node,
    resources,
    Sprite,
    SpriteFrame,
    Texture2D,
    UITransform,
    Vec2,
    Vec4,
} from 'cc';

const { ccclass, executeInEditMode, property, requireComponent } = _decorator;

/** 每个 GPU 批次的容量；总数据量不受此值限制，组件会自动拆批。 */
const SEGMENTS_PER_BATCH = 16;
const FRAMES_PER_BATCH = 16;
const DEFAULT_EFFECT_PATH = 'effects/slots-win-line-frame';
const BATCH_NODE_NAME = '__slots_win_batch__';
const CLIP_EPSILON = 0.00001;

export enum SlotsWinDrawMode {
    LINE_ONLY = 0,
    FRAME_ONLY = 1,
    LINE_AND_FRAME = 2,
}

export enum SlotsWinLayerOrder {
    FRAME_ABOVE_LINE = 0,
    LINE_ABOVE_FRAME = 1,
}

/** 中奖线经过折线点时的转折方式。 */
export enum SlotsWinLineCornerStyle {
    /** 保留原始折线的直接转折。 */
    SHARP = 0,
    /** 在折线点两侧按指定半径生成圆弧。 */
    ROUNDED = 1,
}

/** 中奖线的初始绘制表现。 */
export enum SlotsWinLineDrawStyle {
    /** 直接显示完整中奖线。 */
    COMPLETE = 0,
    /** 按节点本地 X 轴方向随时间逐渐显示。 */
    X_AXIS_REVEAL = 1,
}

/** 动态绘制沿节点本地 X 轴的方向。 */
export enum SlotsWinLineRevealDirection {
    LEFT_TO_RIGHT = 0,
    RIGHT_TO_LEFT = 1,
}

/** 扫光随时间推进时使用的坐标方式。 */
export enum SlotsWinLineSweepProgressMode {
    /** 沿折线自身从起点到终点推进，保留原有表现。 */
    ALONG_PATH = 0,
    /** 沿节点本地 X 轴推进，同一 X 坐标的扫光进度一致。 */
    X_AXIS = 1,
}

export enum SlotsWinFrameShape {
    RECTANGLE = 0,
    CIRCLE = 1,
}

/** 一个中奖框。position 是相对 SlotsWinRenderer 节点锚点的本地坐标。 */
@ccclass('SlotsWinFrameConfig')
export class SlotsWinFrameConfig {
    @property({ type: Enum(SlotsWinFrameShape), tooltip: '矩形或圆形' })
    shape: SlotsWinFrameShape = SlotsWinFrameShape.RECTANGLE;

    @property({ tooltip: '框中心的节点本地坐标（像素）' })
    position = new Vec2();

    @property({ min: 0, tooltip: '矩形宽度（像素），圆形时忽略' })
    width = 100;

    @property({ min: 0, tooltip: '矩形高度（像素），圆形时忽略' })
    height = 100;

    @property({ min: 0, tooltip: '圆形半径（像素），矩形时忽略' })
    radius = 50;
}

interface LineSegmentData {
    start: Vec2;
    end: Vec2;
    /** 保持裁剪前的累计长度，使纹理跨批次、跨裁剪缺口仍连续。 */
    distanceFromLineStart: number;
}

interface ClipInterval {
    start: number;
    end: number;
}

interface LineBatch {
    kind: 'line';
    segments: LineSegmentData[];
    /** 圆弧展开后的整条中奖线长度，用于让扫光跨批次连续循环。 */
    totalLength: number;
    /** 所有批次共用同一个 X 范围，保证动态绘制进度一致。 */
    minX: number;
    maxX: number;
}

interface FrameBatch {
    kind: 'frame';
    frames: SlotsWinFrameConfig[];
}

type RenderBatch = LineBatch | FrameBatch;

/**
 * Slots 中奖线/框渲染器。
 * 挂在一个有 UITransform 的专用节点上，节点尺寸应覆盖整个中奖区域。
 */
@ccclass('SlotsWinRenderer')
@executeInEditMode(true)
@requireComponent(Sprite)
export class SlotsWinRenderer extends Component {
    @property({ type: EffectAsset, tooltip: '可不填；运行时会从 resources/effects 自动加载默认 Effect' })
    effectAsset: EffectAsset | null = null;

    @property({ type: Enum(SlotsWinDrawMode), tooltip: '只画线、只画框，或两者都画' })
    drawMode: SlotsWinDrawMode = SlotsWinDrawMode.LINE_AND_FRAME;

    @property({ type: Enum(SlotsWinLayerOrder), tooltip: '线和框重叠时谁显示在上面' })
    layerOrder: SlotsWinLayerOrder = SlotsWinLayerOrder.FRAME_ABOVE_LINE;

    @property({ type: [Vec2], tooltip: '折线节点的本地坐标，按数组顺序依次连接；总数不设上限' })
    linePoints: Vec2[] = [];

    @property({ type: Enum(SlotsWinLineCornerStyle), tooltip: '折线转折样式：直接转折或圆弧转折' })
    lineCornerStyle: SlotsWinLineCornerStyle = SlotsWinLineCornerStyle.SHARP;

    @property({ min: 0, tooltip: '圆弧转角半径（像素）；相邻线段过短时会自动缩小' })
    lineCornerRadius = 24;

    @property({ min: 1, max: 32, step: 1, tooltip: '每个圆弧转角使用的线段数，数值越大越平滑' })
    lineCornerSegments = 8;

    @property({ min: 0, tooltip: '中奖线宽度（像素）' })
    lineWidth = 8;

    @property({ tooltip: '中奖线纯色；使用纹理时作为纹理染色' })
    lineColor = new Color(255, 200, 31, 255);   // #FFC81F

    @property({ tooltip: '中奖线是否使用纹理' })
    useLineTexture = false;

    @property({ type: Texture2D, tooltip: '中奖线纹理；为空时使用白色纹理' })
    lineTexture: Texture2D | null = null;

    @property({ min: 1, tooltip: '中奖线纹理沿线方向每多少像素重复一次' })
    lineTextureRepeat = 128;

    @property({ type: Enum(SlotsWinLineDrawStyle), tooltip: '直接显示完整中奖线，或沿本地 X 轴动态绘制' })
    lineDrawStyle: SlotsWinLineDrawStyle = SlotsWinLineDrawStyle.COMPLETE;

    @property({ type: Enum(SlotsWinLineRevealDirection), tooltip: '动态绘制沿本地 X 轴的方向' })
    lineRevealDirection: SlotsWinLineRevealDirection = SlotsWinLineRevealDirection.LEFT_TO_RIGHT;

    @property({ min: 0.01, tooltip: '中奖线从一端绘制到另一端所需时间（秒）' })
    lineRevealDuration = 0.8;

    @property({ tooltip: '是否开启沿整条中奖线移动的扫光' })
    enableLineSweep = false;

    @property({ type: Enum(SlotsWinLineSweepProgressMode), tooltip: '扫光沿折线路径推进，或沿本地 X 轴统一推进' })
    lineSweepProgressMode: SlotsWinLineSweepProgressMode = SlotsWinLineSweepProgressMode.X_AXIS;

    @property({ tooltip: '扫光颜色；透明度用于控制扫光强度' })
    lineSweepColor = new Color(255, 255, 230, 230);

    @property({ min: 1, tooltip: '扫光带宽度（像素，沿中奖线方向）' })
    lineSweepWidth = 96;

    @property({ tooltip: '扫光移动速度（像素/秒）；负数表示反向移动' })
    lineSweepSpeed = 180;

    @property({ min: 0.01, max: 1, step: 0.05, tooltip: '扫光边缘柔和度，越大越柔和' })
    lineSweepSoftness = 0.65;

    @property({ type: [SlotsWinFrameConfig], tooltip: '矩形框和圆形框列表；总数不设上限' })
    frames: SlotsWinFrameConfig[] = [];

    @property({ min: 0, tooltip: '中奖框描边宽度（像素）' })
    frameWidth = 8;

    @property({ tooltip: '中奖框纯色；使用纹理时作为纹理染色' })
    frameColor = new Color(255, 77, 20, 255);   // #FF4D14

    @property({ tooltip: '中奖框是否使用纹理' })
    useFrameTexture = false;

    @property({ type: Texture2D, tooltip: '中奖框纹理；为空时使用白色纹理' })
    frameTexture: Texture2D | null = null;

    @property({ tooltip: '中奖线经过中奖框内部时，是否继续绘制该段线' })
    drawLineInsideFrames = true;

    @property({ min: 0.5, max: 3, step: 0.1, tooltip: '边缘柔和度，通常保持 1 即可' })
    antialiasSoftness = 1;

    private _loadingEffect = false;
    /** cc_time 使用秒，这里保存本轮动态绘制的全局起始秒数。 */
    private _lineRevealStartTime = 0;
    private _ownedSpriteFrame: SpriteFrame | null = null;
    private readonly _batchNodes: Node[] = [];
    private readonly _batchMaterials: Material[] = [];

    protected onLoad(): void {
        this.resetLineRevealTime();
        this.ensureSpriteFrame(this.getComponent(Sprite));
        this.ensureEffect();
    }

    protected onEnable(): void {
        this.node.on(Node.EventType.SIZE_CHANGED, this.syncNow, this);
        this.resetLineRevealTime();
        this.ensureSpriteFrame(this.getComponent(Sprite));
        this.ensureEffect();
        this.syncNow();
    }

    protected onDisable(): void {
        this.node.off(Node.EventType.SIZE_CHANGED, this.syncNow, this);
    }

    protected onDestroy(): void {
        this.node.off(Node.EventType.SIZE_CHANGED, this.syncNow, this);
        this.clearBatches();
        this._ownedSpriteFrame?.destroy();
        this._ownedSpriteFrame = null;
    }

    /** Inspector 中修改配置后，编辑器会立即刷新预览。 */
    protected onValidate(): void {
        // Inspector 中修改动态绘制参数后，从头播放，方便直接观察效果。
        this.resetLineRevealTime();
        this.ensureSpriteFrame(this.getComponent(Sprite));
        this.ensureEffect();
        this.syncNow();
    }

    /** 运行时替换单条中奖线的本地坐标点，点数不设上限。 */
    public setLinePoints(points: ReadonlyArray<Vec2>): void {
        this.linePoints = points.map((point) => point.clone());
        if (this.lineDrawStyle === SlotsWinLineDrawStyle.X_AXIS_REVEAL) {
            this.resetLineRevealTime();
        }
        this.syncNow();
    }

    /** 运行时开启或关闭中奖线扫光，并立即刷新当前绘制批次。 */
    public setLineSweepEnabled(enabled: boolean): void {
        this.enableLineSweep = enabled;
        this.syncNow();
    }

    /** 切换到动态绘制并从头播放；播放结束后保持完整显示。 */
    public playLineReveal(): void {
        this.lineDrawStyle = SlotsWinLineDrawStyle.X_AXIS_REVEAL;
        this.resetLineRevealTime();
        this.syncNow();
    }

    /** 立即显示完整中奖线。 */
    public showCompleteLine(): void {
        this.lineDrawStyle = SlotsWinLineDrawStyle.COMPLETE;
        this.syncNow();
    }

    /** 运行时替换中奖框列表，框数不设上限。 */
    public setFrames(frames: ReadonlyArray<SlotsWinFrameConfig>): void {
        this.frames = frames.slice();
        this.syncNow();
    }

    /** 修改任意公开配置后调用，组件会重新裁剪并自动生成所需批次。 */
    public syncNow(): void {
        if (!this.effectAsset || !this.isValid) {
            return;
        }
        this.rebuildBatches(this.createRenderBatches());
    }

    private ensureEffect(): void {
        if (this.effectAsset || this._loadingEffect) {
            return;
        }

        // effect 位于 resources 内，未手动绑定时也能在运行时正常工作。
        this._loadingEffect = true;
        resources.load(DEFAULT_EFFECT_PATH, EffectAsset, (loadError, asset) => {
            this._loadingEffect = false;
            if (!this.isValid) {
                return;
            }
            if (loadError || !asset) {
                error(`[SlotsWinRenderer] 无法加载 ${DEFAULT_EFFECT_PATH}.effect`, loadError);
                return;
            }
            this.effectAsset = asset;
            this.syncNow();
        });
    }

    private createRenderBatches(): RenderBatch[] {
        const lineBatches = this.shouldDrawLine() ? this.buildLineBatches() : [];
        const frameBatches = this.shouldDrawFrame()
            ? this.chunkFrames(this.frames)
            : [];

        return this.layerOrder === SlotsWinLayerOrder.LINE_ABOVE_FRAME
            ? [...frameBatches, ...lineBatches]
            : [...lineBatches, ...frameBatches];
    }

    /** 只生成一次圆弧点和总长度，避免批次较多时重复计算。 */
    private buildLineBatches(): LineBatch[] {
        const renderPoints = this.buildRenderableLinePoints();
        const totalLength = this.calculateLineLength(renderPoints);
        const bounds = this.calculateLineXBounds(renderPoints);
        return this.chunkSegments(
            this.buildVisibleSegments(renderPoints),
            totalLength,
            bounds.min,
            bounds.max,
        );
    }

    private shouldDrawLine(): boolean {
        return this.drawMode !== SlotsWinDrawMode.FRAME_ONLY && this.linePoints.length >= 2;
    }

    private shouldDrawFrame(): boolean {
        return this.drawMode !== SlotsWinDrawMode.LINE_ONLY && this.frames.length > 0;
    }

    private buildVisibleSegments(renderPoints: ReadonlyArray<Vec2>): LineSegmentData[] {
        const result: LineSegmentData[] = [];
        let traveled = 0;

        for (let index = 0; index < renderPoints.length - 1; index++) {
            const start = renderPoints[index];
            const end = renderPoints[index + 1];
            const segmentLength = Vec2.distance(start, end);
            if (segmentLength <= CLIP_EPSILON) {
                continue;
            }

            const visibleIntervals = this.drawLineInsideFrames
                ? [{ start: 0, end: 1 }]
                : this.findOutsideIntervals(start, end);
            for (const interval of visibleIntervals) {
                result.push({
                    start: Vec2.lerp(new Vec2(), start, end, interval.start),
                    end: Vec2.lerp(new Vec2(), start, end, interval.end),
                    distanceFromLineStart: traveled + segmentLength * interval.start,
                });
            }
            traveled += segmentLength;
        }
        return result;
    }

    /** 计算圆弧展开后的整条路径长度，供纹理和扫光保持连续。 */
    private calculateLineLength(points: ReadonlyArray<Vec2>): number {
        let length = 0;
        for (let index = 0; index < points.length - 1; index++) {
            length += Vec2.distance(points[index], points[index + 1]);
        }
        return length;
    }

    /** 动态绘制只看整条线的全局 X 范围，不按线段长度分别推进。 */
    private calculateLineXBounds(points: ReadonlyArray<Vec2>): { min: number; max: number } {
        if (points.length === 0) {
            return { min: 0, max: 0 };
        }
        let min = points[0].x;
        let max = points[0].x;
        for (let index = 1; index < points.length; index++) {
            min = Math.min(min, points[index].x);
            max = Math.max(max, points[index].x);
        }
        // 线段使用圆头，需要把半个线宽和抗锯齿边缘算进范围，100% 时才会完整显示。
        const padding = Math.max(this.lineWidth, 0) * 0.5 + Math.max(this.antialiasSoftness, 0.5);
        return { min: min - padding, max: max + padding };
    }

    /**
     * 根据转折配置生成真正参与绘制的点。
     * 圆弧只增加渲染线段，原始 linePoints 不会被修改。
     */
    private buildRenderableLinePoints(): Vec2[] {
        const points = this.removeDuplicateLinePoints();
        if (this.lineCornerStyle !== SlotsWinLineCornerStyle.ROUNDED
            || this.lineCornerRadius <= CLIP_EPSILON
            || points.length < 3) {
            return points;
        }

        const result: Vec2[] = [points[0].clone()];
        for (let index = 1; index < points.length - 1; index++) {
            this.appendRoundedCorner(result, points[index - 1], points[index], points[index + 1]);
        }
        this.appendUniquePoint(result, points[points.length - 1]);
        return result;
    }

    /** 连续重复点没有长度，先移除，避免圆弧方向计算出现除零。 */
    private removeDuplicateLinePoints(): Vec2[] {
        const result: Vec2[] = [];
        for (const point of this.linePoints) {
            this.appendUniquePoint(result, point);
        }
        return result;
    }

    /** 在一个折线点处追加两侧切点和中间圆弧采样点。 */
    private appendRoundedCorner(result: Vec2[], previous: Vec2, corner: Vec2, next: Vec2): void {
        const incomingLength = Vec2.distance(previous, corner);
        const outgoingLength = Vec2.distance(corner, next);
        const incoming = new Vec2(
            (corner.x - previous.x) / incomingLength,
            (corner.y - previous.y) / incomingLength,
        );
        const outgoing = new Vec2(
            (next.x - corner.x) / outgoingLength,
            (next.y - corner.y) / outgoingLength,
        );
        const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
        const dot = Math.max(-1, Math.min(1, Vec2.dot(incoming, outgoing)));
        const sweepAngle = Math.atan2(cross, dot);

        // 共线、反向折返或太小的转角没有稳定圆心，直接保留原折点。
        if (Math.abs(cross) <= CLIP_EPSILON
            || Math.abs(sweepAngle) <= CLIP_EPSILON
            || Math.abs(Math.PI - Math.abs(sweepAngle)) <= CLIP_EPSILON) {
            this.appendUniquePoint(result, corner);
            return;
        }

        const tangentFactor = Math.tan(Math.abs(sweepAngle) * 0.5);
        const requestedTrim = Math.max(this.lineCornerRadius, 0) * tangentFactor;
        const trim = Math.min(requestedTrim, incomingLength * 0.5, outgoingLength * 0.5);
        if (trim <= CLIP_EPSILON || tangentFactor <= CLIP_EPSILON) {
            this.appendUniquePoint(result, corner);
            return;
        }

        const radius = trim / tangentFactor;
        const tangentStart = new Vec2(
            corner.x - incoming.x * trim,
            corner.y - incoming.y * trim,
        );
        const tangentEnd = new Vec2(
            corner.x + outgoing.x * trim,
            corner.y + outgoing.y * trim,
        );
        const turnSide = cross > 0 ? 1 : -1;
        const center = new Vec2(
            tangentStart.x - incoming.y * radius * turnSide,
            tangentStart.y + incoming.x * radius * turnSide,
        );

        this.appendUniquePoint(result, tangentStart);
        this.appendArcPoints(result, center, tangentStart, tangentEnd, sweepAngle);
    }

    /** 使用若干短线段逼近圆弧，线段会继续交给既有的无限分批逻辑。 */
    private appendArcPoints(
        result: Vec2[],
        center: Vec2,
        tangentStart: Vec2,
        tangentEnd: Vec2,
        sweepAngle: number,
    ): void {
        const segmentCount = Math.max(1, Math.round(this.lineCornerSegments));
        const radius = Vec2.distance(center, tangentStart);
        const startAngle = Math.atan2(tangentStart.y - center.y, tangentStart.x - center.x);

        for (let step = 1; step < segmentCount; step++) {
            const angle = startAngle + sweepAngle * step / segmentCount;
            this.appendUniquePoint(result, new Vec2(
                center.x + Math.cos(angle) * radius,
                center.y + Math.sin(angle) * radius,
            ));
        }
        this.appendUniquePoint(result, tangentEnd);
    }

    /** 追加点时顺便过滤浮点误差造成的零长度线段。 */
    private appendUniquePoint(points: Vec2[], point: Vec2): void {
        const previous = points[points.length - 1];
        if (!previous || Vec2.distance(previous, point) > CLIP_EPSILON) {
            points.push(point.clone());
        }
    }

    /** 求线段位于所有框外部的区间；框会按半个线宽外扩，避免圆头重新伸入框内。 */
    private findOutsideIntervals(start: Vec2, end: Vec2): ClipInterval[] {
        const insideIntervals: ClipInterval[] = [];
        const padding = Math.max(this.lineWidth, 0) * 0.5;

        for (const frame of this.frames) {
            const interval = frame.shape === SlotsWinFrameShape.CIRCLE
                ? this.intersectCircle(start, end, frame, padding)
                : this.intersectRectangle(start, end, frame, padding);
            if (interval) {
                insideIntervals.push(interval);
            }
        }
        return this.invertIntervals(this.mergeIntervals(insideIntervals));
    }

    private intersectCircle(
        start: Vec2,
        end: Vec2,
        frame: SlotsWinFrameConfig,
        padding: number,
    ): ClipInterval | null {
        const direction = Vec2.subtract(new Vec2(), end, start);
        const fromCenter = Vec2.subtract(new Vec2(), start, frame.position);
        const radius = Math.max(frame.radius, 0) + padding;
        const a = Vec2.dot(direction, direction);
        const b = 2 * Vec2.dot(fromCenter, direction);
        const c = Vec2.dot(fromCenter, fromCenter) - radius * radius;
        const discriminant = b * b - 4 * a * c;

        if (discriminant < 0 || a <= CLIP_EPSILON) {
            return c <= 0 ? { start: 0, end: 1 } : null;
        }
        const root = Math.sqrt(discriminant);
        const first = (-b - root) / (2 * a);
        const second = (-b + root) / (2 * a);
        return this.clampInterval(first, second);
    }

    /** Liang-Barsky 线段/AABB 相交，返回处于矩形内部的参数区间。 */
    private intersectRectangle(
        start: Vec2,
        end: Vec2,
        frame: SlotsWinFrameConfig,
        padding: number,
    ): ClipInterval | null {
        const halfWidth = Math.max(frame.width, 0) * 0.5 + padding;
        const halfHeight = Math.max(frame.height, 0) * 0.5 + padding;
        const minX = frame.position.x - halfWidth;
        const maxX = frame.position.x + halfWidth;
        const minY = frame.position.y - halfHeight;
        const maxY = frame.position.y + halfHeight;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        let enter = 0;
        let leave = 1;

        const clips: ReadonlyArray<readonly [number, number]> = [
            [-dx, start.x - minX],
            [dx, maxX - start.x],
            [-dy, start.y - minY],
            [dy, maxY - start.y],
        ];
        for (const [normal, distance] of clips) {
            if (Math.abs(normal) <= CLIP_EPSILON) {
                if (distance < 0) {
                    return null;
                }
                continue;
            }
            const ratio = distance / normal;
            if (normal < 0) {
                enter = Math.max(enter, ratio);
            } else {
                leave = Math.min(leave, ratio);
            }
            if (enter > leave) {
                return null;
            }
        }
        return this.clampInterval(enter, leave);
    }

    private clampInterval(start: number, end: number): ClipInterval | null {
        const clippedStart = Math.max(0, Math.min(start, end));
        const clippedEnd = Math.min(1, Math.max(start, end));
        return clippedEnd - clippedStart > CLIP_EPSILON
            ? { start: clippedStart, end: clippedEnd }
            : null;
    }

    private mergeIntervals(intervals: ClipInterval[]): ClipInterval[] {
        if (intervals.length === 0) {
            return [];
        }
        intervals.sort((left, right) => left.start - right.start);
        const merged: ClipInterval[] = [{ ...intervals[0] }];
        for (let index = 1; index < intervals.length; index++) {
            const current = intervals[index];
            const previous = merged[merged.length - 1];
            if (current.start <= previous.end + CLIP_EPSILON) {
                previous.end = Math.max(previous.end, current.end);
            } else {
                merged.push({ ...current });
            }
        }
        return merged;
    }

    private invertIntervals(inside: ClipInterval[]): ClipInterval[] {
        const outside: ClipInterval[] = [];
        let cursor = 0;
        for (const interval of inside) {
            if (interval.start - cursor > CLIP_EPSILON) {
                outside.push({ start: cursor, end: interval.start });
            }
            cursor = Math.max(cursor, interval.end);
        }
        if (1 - cursor > CLIP_EPSILON) {
            outside.push({ start: cursor, end: 1 });
        }
        return outside;
    }

    private chunkSegments(
        segments: LineSegmentData[],
        totalLength: number,
        minX: number,
        maxX: number,
    ): LineBatch[] {
        const batches: LineBatch[] = [];
        for (let index = 0; index < segments.length; index += SEGMENTS_PER_BATCH) {
            batches.push({
                kind: 'line',
                segments: segments.slice(index, index + SEGMENTS_PER_BATCH),
                totalLength,
                minX,
                maxX,
            });
        }
        return batches;
    }

    private chunkFrames(frames: SlotsWinFrameConfig[]): FrameBatch[] {
        const batches: FrameBatch[] = [];
        for (let index = 0; index < frames.length; index += FRAMES_PER_BATCH) {
            batches.push({ kind: 'frame', frames: frames.slice(index, index + FRAMES_PER_BATCH) });
        }
        return batches;
    }

    private rebuildBatches(batches: RenderBatch[]): void {
        this.clearBatches();
        const parentSprite = this.getComponent(Sprite);
        if (!parentSprite) {
            return;
        }
        parentSprite.enabled = batches.length > 0;

        for (let index = 0; index < batches.length; index++) {
            const sprite = index === 0 ? parentSprite : this.createBatchSprite(index);
            const material = this.createBatchMaterial(batches[index]);
            sprite.customMaterial = material;
            this._batchMaterials.push(material);
        }
    }

    private createBatchSprite(index: number): Sprite {
        const sourceTransform = this.getComponent(UITransform)!;
        const batchNode = new Node(`${BATCH_NODE_NAME}${index}`);
        // 编辑器预览节点不写入场景文件，避免保存后出现重复批次。
        batchNode.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
        batchNode.layer = this.node.layer;
        batchNode.setPosition(0, 0, 0);
        this.node.addChild(batchNode);

        const transform = batchNode.addComponent(UITransform);
        transform.setContentSize(sourceTransform.contentSize);
        transform.setAnchorPoint(sourceTransform.anchorPoint);
        const sprite = batchNode.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        // 所有批次共享同一张白色 SpriteFrame，避免重建批次时产生临时资源。
        sprite.spriteFrame = this.getComponent(Sprite)!.spriteFrame;
        this._batchNodes.push(batchNode);
        return sprite;
    }

    private createBatchMaterial(batch: RenderBatch): Material {
        const material = new Material();
        material.initialize({ effectAsset: this.effectAsset! });
        this.setCommonMaterialProperties(material, batch);

        if (batch.kind === 'line') {
            this.setLineBatchProperties(material, batch.segments);
        } else {
            this.setFrameBatchProperties(material, batch.frames);
        }
        return material;
    }

    private setCommonMaterialProperties(material: Material, batch: RenderBatch): void {
        const whiteTexture = builtinResMgr.get<Texture2D>('white-texture');
        const lineBatch = batch.kind === 'line' ? batch : null;
        const transform = this.getComponent(UITransform)!;
        const size = transform.contentSize;
        const anchor = transform.anchorPoint;
        material.setProperty('styleConfig', new Vec4(
            Math.max(this.lineWidth, 0),
            Math.max(this.frameWidth, 0),
            Math.max(this.antialiasSoftness, 0.5),
            1,
        ));
        material.setProperty('textureConfig', new Vec4(
            this.useLineTexture ? 1 : 0,
            this.useFrameTexture ? 1 : 0,
            Math.max(this.lineTextureRepeat, 1),
            Math.max(lineBatch?.totalLength ?? 0, 0),
        ));
        material.setProperty('lineSweepConfig', new Vec4(
            this.enableLineSweep ? 1 : 0,
            Math.max(this.lineSweepWidth, 1),
            this.lineSweepSpeed,
            Math.max(0.01, Math.min(this.lineSweepSoftness, 1)),
        ));
        material.setProperty('lineRevealConfig', new Vec4(
            this.lineDrawStyle === SlotsWinLineDrawStyle.X_AXIS_REVEAL ? 1 : 0,
            Math.max(this.lineRevealDuration, 0.01),
            this._lineRevealStartTime,
            this.lineRevealDirection,
        ));
        material.setProperty('lineRevealBounds', new Vec4(
            lineBatch?.minX ?? 0,
            lineBatch?.maxX ?? 0,
            this.lineSweepProgressMode,
            0,
        ));
        material.setProperty('localBounds', new Vec4(
            -anchor.x * size.width,
            -anchor.y * size.height,
            size.width,
            size.height,
        ));
        material.setProperty('lineColor', this.lineColor);
        material.setProperty('lineSweepColor', this.lineSweepColor);
        material.setProperty('frameColor', this.frameColor);
        material.setProperty('lineTexture', this.lineTexture ?? whiteTexture);
        material.setProperty('frameTexture', this.frameTexture ?? whiteTexture);
    }

    private setLineBatchProperties(material: Material, segments: LineSegmentData[]): void {
        const segmentUniforms = SlotsWinRenderer.createUniformArray(SEGMENTS_PER_BATCH);
        const infoUniforms = SlotsWinRenderer.createUniformArray(SEGMENTS_PER_BATCH);
        for (let index = 0; index < segments.length; index++) {
            const segment = segments[index];
            segmentUniforms[index].set(segment.start.x, segment.start.y, segment.end.x, segment.end.y);
            infoUniforms[index].x = segment.distanceFromLineStart;
        }
        material.setProperty('drawConfig', new Vec4(segments.length, 0, SlotsWinDrawMode.LINE_ONLY, 0));
        material.setProperty('lineSegments', segmentUniforms);
        material.setProperty('lineSegmentInfo', infoUniforms);
        material.setProperty('frameData', SlotsWinRenderer.createUniformArray(FRAMES_PER_BATCH));
    }

    private setFrameBatchProperties(material: Material, frames: SlotsWinFrameConfig[]): void {
        const frameUniforms = SlotsWinRenderer.createUniformArray(FRAMES_PER_BATCH);
        for (let index = 0; index < frames.length; index++) {
            const frame = frames[index];
            if (frame.shape === SlotsWinFrameShape.CIRCLE) {
                frameUniforms[index].set(frame.position.x, frame.position.y, Math.max(frame.radius, 0), -1);
            } else {
                frameUniforms[index].set(
                    frame.position.x,
                    frame.position.y,
                    Math.max(frame.width, 0) * 0.5,
                    Math.max(frame.height, 0) * 0.5,
                );
            }
        }
        material.setProperty('drawConfig', new Vec4(0, frames.length, SlotsWinDrawMode.FRAME_ONLY, 0));
        material.setProperty('lineSegments', SlotsWinRenderer.createUniformArray(SEGMENTS_PER_BATCH));
        material.setProperty('lineSegmentInfo', SlotsWinRenderer.createUniformArray(SEGMENTS_PER_BATCH));
        material.setProperty('frameData', frameUniforms);
    }

    private clearBatches(): void {
        const parentSprite = this.getComponent(Sprite);
        if (parentSprite) {
            parentSprite.customMaterial = null;
        }
        for (const material of this._batchMaterials) {
            material.destroy();
        }
        for (const batchNode of this._batchNodes) {
            batchNode.destroy();
        }
        this._batchMaterials.length = 0;
        this._batchNodes.length = 0;
    }

    private ensureSpriteFrame(sprite: Sprite | null): void {
        if (!sprite || sprite.spriteFrame) {
            return;
        }
        const spriteFrame = new SpriteFrame();
        spriteFrame.hideFlags |= CCObject.Flags.DontSave;
        spriteFrame.texture = builtinResMgr.get<Texture2D>('white-texture');
        // 内置白纹理没有 HTMLImageElement/Canvas 图片源，不能复制进动态合图。
        spriteFrame.packable = false;
        sprite.spriteFrame = spriteFrame;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;

        // 只记录父节点的临时 SpriteFrame；子批次随节点销毁。
        if (sprite.node === this.node) {
            this._ownedSpriteFrame = spriteFrame;
        }
    }

    /** 记录与 Shader 内 cc_time.x 相同时间轴上的起始时间。 */
    private resetLineRevealTime(): void {
        this._lineRevealStartTime = director.root?.cumulativeTime ?? 0;
    }

    private static createUniformArray(length: number): Vec4[] {
        return Array.from({ length }, () => new Vec4());
    }
}
